export const WOO_SIMULATION_NOTICE =
  'Simulated sync — runs entirely in this browser. No WooCommerce store or API credentials are configured, and no network requests are made.'

export const LIVE_MODE_WARNING =
  'Live mode sends real REST requests to your store through the local sync proxy. Credentials are read from server-side environment variables (.env.local) and never reach the browser. This path has not been exercised against a real store in this project — verify with a staging store first.'

export const SYNC_MODES = {
  simulated: {
    id: 'simulated',
    label: 'Simulated demo',
    tagline: 'Local only · no network',
    description:
      'Builds a WooCommerce-shaped payload, assigns a deterministic demo ID and records the run locally.',
  },
  live: {
    id: 'live',
    label: 'Live store',
    tagline: 'Real REST requests · untested',
    description:
      'Sends the payload through the local proxy to your configured store (POST to create, PUT to update).',
  },
}

export const LIVE_API_BASE = '/api/woo'

export function isSyncMode(value) {
  return value === 'simulated' || value === 'live'
}

export function wooIdFromSku(sku = '') {
  let hash = 7
  const normalized = String(sku).trim().toUpperCase()
  for (const character of normalized) {
    hash = (hash * 31 + character.charCodeAt(0)) % 899999
  }
  return 100000 + hash
}

export function buildSyncPayload(product) {
  const attributes = []
  if (product.color) attributes.push({ name: 'Color', options: [product.color], visible: true })
  if (product.size) attributes.push({ name: 'Size', options: [product.size], visible: true })
  if (product.material) attributes.push({ name: 'Material', options: [product.material], visible: true })
  for (const attribute of product.attributes ?? []) {
    attributes.push({ name: attribute.name, options: attribute.values, visible: true })
  }
  return {
    name: product.name,
    sku: product.sku,
    regular_price: Number(product.price).toFixed(2),
    stock_quantity: product.stock,
    manage_stock: Number.isFinite(Number(product.stock)),
    status: product.status === 'published' ? 'publish' : 'draft',
    description: product.description,
    categories: [{ name: product.category }],
    attributes,
  }
}

export function markSynced(product, { wooId, syncedAt, mode }) {
  return {
    ...product,
    wooId,
    syncStatus: 'synced',
    syncError: null,
    lastSyncedAt: syncedAt,
    lastSyncMode: mode === 'live' ? 'live' : 'simulated',
  }
}

export function markSyncError(product, message) {
  return {
    ...product,
    syncStatus: 'error',
    syncError: message,
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function pushProductToSimulatedStore(product, { delay = 500, fail = false } = {}) {
  if (delay > 0) await sleep(delay)
  if (fail) throw new Error('Simulated WooCommerce request failed (forced failure).')
  const payload = buildSyncPayload(product)
  return markSynced(product, {
    wooId: product.wooId ?? wooIdFromSku(payload.sku),
    syncedAt: new Date().toISOString(),
    mode: 'simulated',
  })
}

export async function fetchLiveStatus({ fetchImpl } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') {
    return {
      configured: false,
      storeHost: null,
      missing: [],
      invalidUrl: false,
      urlError: null,
      insecureLocal: false,
      error: 'fetch is not available in this environment.',
    }
  }
  try {
    const response = await doFetch(`${LIVE_API_BASE}/status`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    return {
      configured: Boolean(data?.configured),
      storeHost: typeof data?.storeHost === 'string' ? data.storeHost : null,
      missing: Array.isArray(data?.missing) ? data.missing : [],
      invalidUrl: Boolean(data?.invalidUrl),
      urlError: typeof data?.urlError === 'string' ? data.urlError : null,
      insecureLocal: Boolean(data?.insecureLocal),
      error: null,
    }
  } catch (error) {
    return {
      configured: false,
      storeHost: null,
      missing: [],
      invalidUrl: false,
      urlError: null,
      insecureLocal: false,
      error: `The local sync proxy is not reachable (${error.message}). Serve the app with "npm run dev", "npm run preview" or "npm start".`,
    }
  }
}

export function liveBlockReason(status, checking = false) {
  if (!status) {
    return checking
      ? 'Still checking the server configuration — try again in a moment.'
      : 'The local sync proxy has not been reachable yet. Serve the app with "npm run dev", "npm run preview" or "npm start".'
  }
  if (status.error) return `The local sync proxy is unreachable. ${status.error}`
  if (!status.configured) {
    if (status.urlError) return status.urlError
    return `Live sync is not configured on the server. Missing: ${
      status.missing.join(', ') || 'WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET'
    }.`
  }
  return null
}

const REQUEST_TIMEOUT_MS = 20000

async function requestLive(path, { method = 'GET', body, fetchImpl } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') throw new Error('fetch is not available in this environment.')

  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      : undefined

  let response
  try {
    response = await doFetch(`${LIVE_API_BASE}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-PIM-Sync': '1',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('The local sync proxy did not respond in time. Check the dev server and try again.', {
        cause: error,
      })
    }
    throw new Error(`The local sync proxy is not reachable: ${error.message}`, { cause: error })
  }

  let data
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    const error = new Error(data?.error || `Sync proxy error (HTTP ${response.status})`)
    error.code = typeof data?.code === 'string' ? data.code : null
    error.status = response.status
    throw error
  }

  return data
}

export async function findProductBySku(sku, { fetchImpl } = {}) {
  const query = encodeURIComponent(String(sku ?? '').trim())
  const data = await requestLive(`/products?sku=${query}`, { fetchImpl })
  return data?.product ?? null
}

export async function pushProductToLiveStore(product, { fetchImpl } = {}) {
  const payload = buildSyncPayload(product)

  try {
    const data = product.wooId
      ? await requestLive(`/products/${product.wooId}`, { method: 'PUT', body: payload, fetchImpl })
      : await requestLive('/products', { method: 'POST', body: payload, fetchImpl })
    return markSynced(product, {
      wooId: data?.product?.id ?? product.wooId ?? null,
      syncedAt: new Date().toISOString(),
      mode: 'live',
    })
  } catch (error) {
    const skuConflict =
      !product.wooId && (error.code === 'product_invalid_sku' || /sku/i.test(error.code ?? '') || /sku/i.test(error.message))
    if (!skuConflict) throw error

    const existing = await findProductBySku(product.sku, { fetchImpl }).catch(() => null)
    if (!existing?.id) throw error

    const data = await requestLive(`/products/${existing.id}`, { method: 'PUT', body: payload, fetchImpl })
    return markSynced(product, {
      wooId: data?.product?.id ?? existing.id,
      syncedAt: new Date().toISOString(),
      mode: 'live',
    })
  }
}
