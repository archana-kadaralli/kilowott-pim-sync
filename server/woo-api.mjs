import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

/**
 * Server-side WooCommerce proxy for `vite dev`, `vite preview` and the
 * standalone server (`npm start` → server/index.mjs).
 *
 * Credentials are read from environment variables (e.g. .env.local) on the server
 * and attached to upstream requests here. They are never sent to, or stored in,
 * the browser.
 *
 * The proxy is not an open relay:
 * - `GET /api/woo/status` issues an HttpOnly, SameSite=Strict session cookie.
 * - Product routes require that cookie, a same-origin request and (for writes) an
 *   `X-PIM-Sync: 1` header — none of which a cross-site page can satisfy, and no
 *   secret ever needs to be embedded in the React bundle.
 */

export const WOO_API_PREFIX = '/api/woo'
export const SESSION_COOKIE = 'pim_sync_session'
export const DEFAULT_TIMEOUT_MS = 15000
const MAX_BODY_BYTES = 1024 * 1024
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function isPrivateIpv4(hostname) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!match) return false
  const octets = match.slice(1).map(Number)
  if (octets.some((octet) => octet > 255)) return false
  const [a, b] = octets
  if (a === 127) return true // loopback 127.0.0.0/8
  if (a === 10) return true // private 10.0.0.0/8
  if (a === 192 && b === 168) return true // private 192.168.0.0/16
  return a === 172 && b >= 16 && b <= 31 // private 172.16.0.0/12
}

/**
 * Plain HTTP is acceptable only for local-development hosts — loopback names,
 * RFC 6761/6762 reserved names (`*.localhost`, `*.local`, `*.test`, none of
 * which can be a public domain) or private-network IPs — and only when the
 * operator explicitly opts in via WOO_ALLOW_LOCAL_HTTP=1. Every other host
 * must use HTTPS.
 */
export function isLocalHost(hostname) {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (!host) return false
  if (LOCAL_HOSTS.has(host)) return true
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.test')) return true
  return isPrivateIpv4(host)
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
}

export function readWooConfig(env = {}) {
  const storeUrl = String(env.WOO_STORE_URL ?? '').trim().replace(/\/+$/, '')
  const consumerKey = String(env.WOO_CONSUMER_KEY ?? '').trim()
  const consumerSecret = String(env.WOO_CONSUMER_SECRET ?? '').trim()
  const allowLocalHttp = isTruthy(env.WOO_ALLOW_LOCAL_HTTP)

  const missing = []
  if (!storeUrl) missing.push('WOO_STORE_URL')
  if (!consumerKey) missing.push('WOO_CONSUMER_KEY')
  if (!consumerSecret) missing.push('WOO_CONSUMER_SECRET')

  let urlError = null
  let insecureLocal = false
  if (storeUrl) {
    let parsed = null
    try {
      parsed = new URL(storeUrl)
    } catch {
      urlError = 'WOO_STORE_URL is not a valid URL (expected e.g. https://store.example.com).'
    }
    if (parsed) {
      if (parsed.protocol === 'https:') {
        // Always allowed.
      } else if (parsed.protocol === 'http:') {
        if (!isLocalHost(parsed.hostname)) {
          urlError =
            'WOO_STORE_URL must use HTTPS for remote stores. Plain HTTP is only allowed for a local development host (localhost, *.local, *.test or a private-network IP) with WOO_ALLOW_LOCAL_HTTP=1.'
        } else if (!allowLocalHttp) {
          urlError =
            'WOO_STORE_URL points at local HTTP; set WOO_ALLOW_LOCAL_HTTP=1 to allow this during local development only.'
        } else {
          insecureLocal = true
        }
      } else {
        urlError = 'WOO_STORE_URL must use the https:// protocol.'
      }
    }
  }

  const invalidUrl = urlError !== null

  return {
    storeUrl,
    consumerKey,
    consumerSecret,
    allowLocalHttp,
    missing,
    invalidUrl,
    urlError,
    insecureLocal,
    configured: missing.length === 0 && !invalidUrl,
  }
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

export function publicStatus(config) {
  return {
    configured: config.configured,
    storeHost: config.storeUrl ? hostOf(config.storeUrl) : null,
    missing: config.missing,
    invalidUrl: config.invalidUrl,
    urlError: config.urlError,
    insecureLocal: config.insecureLocal,
  }
}

export function wooUrlFor(config, pathAndQuery = '') {
  return `${config.storeUrl}/wp-json/wc/v3/products${pathAndQuery}`
}

function authHeader(config) {
  return `Basic ${Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64')}`
}

function slugifyName(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function storeRequestError(error, timeoutMs) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return {
      status: 504,
      payload: {
        ok: false,
        error: `The store did not respond within ${Math.round(timeoutMs / 1000)} seconds. Check the store URL and try again.`,
        code: 'proxy_timeout',
      },
    }
  }
  return {
    status: 502,
    payload: {
      ok: false,
      error: `Could not reach the store: ${error.message}`,
      code: 'proxy_network_error',
    },
  }
}

async function storeFailure(response) {
  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }
  return {
    status: response.status >= 400 && response.status < 600 ? response.status : 502,
    payload: {
      ok: false,
      error:
        typeof data?.message === 'string' && data.message
          ? data.message
          : `WooCommerce API error (HTTP ${response.status})`,
      code: typeof data?.code === 'string' ? data.code : 'woo_api_error',
    },
  }
}

/**
 * WooCommerce ignores category objects that carry only a name on product
 * writes, so each named category is resolved to an existing term (by slug) or
 * created first, then the product is written with term ids.
 */
async function resolveCategoryIds(config, categories, { fetchImpl, signal, timeoutMs }) {
  const ids = []
  for (const category of categories) {
    if (Number.isInteger(category?.id) && category.id > 0) {
      ids.push({ id: category.id })
      continue
    }
    const name = String(category?.name ?? '').trim()
    if (!name) continue
    try {
      const lookup = await fetchImpl(
        `${config.storeUrl}/wp-json/wc/v3/products/categories?slug=${encodeURIComponent(slugifyName(name))}&per_page=1`,
        { headers: { Authorization: authHeader(config) }, signal },
      )
      if (!lookup.ok) return { failure: await storeFailure(lookup) }
      const matches = await lookup.json()
      if (Array.isArray(matches) && matches.length > 0) {
        ids.push({ id: matches[0].id })
        continue
      }
      const created = await fetchImpl(`${config.storeUrl}/wp-json/wc/v3/products/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader(config) },
        body: JSON.stringify({ name }),
        signal,
      })
      if (!created.ok) return { failure: await storeFailure(created) }
      const term = await created.json()
      if (Number.isInteger(term?.id)) ids.push({ id: term.id })
    } catch (error) {
      return { failure: storeRequestError(error, timeoutMs) }
    }
  }
  return { ids }
}

export async function handleWooRequest({
  config,
  method,
  path = '',
  query = '',
  body,
  fetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!config.configured) {
    return {
      status: 503,
      payload: {
        ok: false,
        error: config.urlError
          ? config.urlError
          : `Live sync is not configured on the server. Missing: ${config.missing.join(', ')}.`,
        code: 'proxy_not_configured',
      },
    }
  }

  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined

  let resolvedBody = body
  if (
    body &&
    Array.isArray(body.categories) &&
    body.categories.some((category) => !(Number.isInteger(category?.id) && category.id > 0))
  ) {
    const resolution = await resolveCategoryIds(config, body.categories, { fetchImpl, signal, timeoutMs })
    if (resolution.failure) return resolution.failure
    resolvedBody = { ...body, categories: resolution.ids }
  }

  let response
  try {
    response = await fetchImpl(wooUrlFor(config, `${path}${query}`), {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(config),
      },
      body: resolvedBody === undefined ? undefined : JSON.stringify(resolvedBody),
      signal,
    })
  } catch (error) {
    return storeRequestError(error, timeoutMs)
  }

  if (!response.ok) {
    return storeFailure(response)
  }

  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  return { status: 200, payload: { ok: true, product: data, storeStatus: response.status } }
}

async function readJsonBody(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.')
      error.statusCode = 413
      throw error
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) return undefined
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text)
  } catch {
    const error = new Error('Request body must be valid JSON.')
    error.statusCode = 400
    throw error
  }
}

function sessionCookieValue(headers, token) {
  const cookie = String(headers.cookie ?? '')
  return cookie
    .split(';')
    .map((part) => part.trim())
    .some((part) => part === `${SESSION_COOKIE}=${token}`)
}

export function createWooMiddleware({ env = {}, fetchImpl = globalThis.fetch, sessionToken = randomUUID() } = {}) {
  const config = readWooConfig(env)

  return async function wooMiddleware(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith(WOO_API_PREFIX)) {
      next()
      return
    }

    const headers = req.headers ?? {}

    function send(status, payload, extraHeaders = {}) {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      for (const [key, value] of Object.entries(extraHeaders)) {
        res.setHeader(key, value)
      }
      res.end(JSON.stringify(payload))
    }

    function isSameOrigin() {
      const origin = headers.origin
      if (!origin) return true
      try {
        return new URL(origin).host === headers.host
      } catch {
        return false
      }
    }

    try {
      if (url.pathname === `${WOO_API_PREFIX}/status` && req.method === 'GET') {
        const secure = req.socket?.encrypted || String(headers['x-forwarded-proto'] ?? '') === 'https'
        send(200, publicStatus(config), {
          'Set-Cookie': `${SESSION_COOKIE}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/${secure ? '; Secure' : ''}`,
        })
        return
      }

      if (req.method === 'OPTIONS') {
        send(403, {
          ok: false,
          error: 'Cross-origin requests are not accepted by the sync proxy.',
          code: 'proxy_forbidden',
        })
        return
      }

      const productMatch = url.pathname.match(new RegExp(`^${WOO_API_PREFIX}/products/(\\d+)$`))
      const isProductsRoute = url.pathname === `${WOO_API_PREFIX}/products` || productMatch !== null
      if (!isProductsRoute) {
        send(404, { ok: false, error: 'Unknown sync proxy route.', code: 'proxy_not_found' })
        return
      }

      if (!isSameOrigin()) {
        send(403, {
          ok: false,
          error: 'Cross-origin requests are not accepted by the sync proxy.',
          code: 'proxy_forbidden',
        })
        return
      }

      if (!sessionCookieValue(headers, sessionToken)) {
        send(401, {
          ok: false,
          error:
            'The sync proxy only accepts requests from this app session. Reload the app (the proxy issues a session cookie on load), then try again.',
          code: 'proxy_unauthorized',
        })
        return
      }

      const isWrite = req.method === 'POST' || req.method === 'PUT'
      if (isWrite && String(headers['x-pim-sync'] ?? '') !== '1') {
        send(401, {
          ok: false,
          error: 'Write requests must come from the PIM Sync app (missing X-PIM-Sync header).',
          code: 'proxy_unauthorized',
        })
        return
      }

      if (url.pathname === `${WOO_API_PREFIX}/products`) {
        if (req.method === 'GET') {
          const sku = (url.searchParams.get('sku') ?? '').trim()
          if (!sku) {
            send(400, { ok: false, error: 'A sku query parameter is required.', code: 'proxy_missing_sku' })
            return
          }
          const result = await handleWooRequest({
            config,
            method: 'GET',
            query: `?sku=${encodeURIComponent(sku)}&per_page=1`,
            fetchImpl,
          })
          const list = Array.isArray(result.payload.product) ? result.payload.product : []
          send(result.status, { ...result.payload, product: result.payload.ok ? list[0] ?? null : undefined })
          return
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req)
          const result = await handleWooRequest({ config, method: 'POST', body, fetchImpl })
          send(result.status, result.payload)
          return
        }
      }

      if (productMatch && req.method === 'PUT') {
        const body = await readJsonBody(req)
        const result = await handleWooRequest({ config, method: 'PUT', path: `/${productMatch[1]}`, body, fetchImpl })
        send(result.status, result.payload)
        return
      }

      send(404, { ok: false, error: 'Unknown sync proxy route.', code: 'proxy_not_found' })
    } catch (error) {
      send(error.statusCode ?? 400, { ok: false, error: error.message, code: 'proxy_bad_request' })
    }
  }
}
