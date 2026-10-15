import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createWooMiddleware,
  handleWooRequest,
  publicStatus,
  readWooConfig,
  SESSION_COOKIE,
  wooUrlFor,
} from '../server/woo-api.mjs'

const VALID_ENV = {
  WOO_STORE_URL: 'https://shop.example.com/',
  WOO_CONSUMER_KEY: 'ck_test',
  WOO_CONSUMER_SECRET: 'cs_test',
}

const TEST_TOKEN = 'test-session-token'
const AUTH_HEADERS = { cookie: `${SESSION_COOKIE}=${TEST_TOKEN}`, 'x-pim-sync': '1', host: 'localhost:5173' }

function jsonResponse(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data }
}

function captureFetch(response) {
  const calls = []
  return {
    calls,
    impl: async (url, options) => {
      calls.push({ url, options })
      return response
    },
  }
}

function createTestMiddleware(overrides = {}) {
  return createWooMiddleware({ env: VALID_ENV, fetchImpl: async () => jsonResponse(200, {}), sessionToken: TEST_TOKEN, ...overrides })
}

async function runMiddleware(middleware, { method = 'GET', url = '/', body, headers = {} } = {}) {
  const res = {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(key, value) {
      this.headers[key] = value
    },
    end(chunk) {
      this.body = chunk
    },
  }
  let nextCalled = false
  await middleware(
    {
      method,
      url,
      headers: { ...AUTH_HEADERS, ...headers },
      socket: {},
      async *[Symbol.asyncIterator]() {
        if (body !== undefined) yield typeof body === 'string' ? body : JSON.stringify(body)
      },
    },
    res,
    () => {
      nextCalled = true
    },
  )
  return { res, nextCalled, json: res.body ? JSON.parse(res.body) : null }
}

// ---------- Configuration ----------

test('readWooConfig reports every missing variable', () => {
  const config = readWooConfig({})
  assert.equal(config.configured, false)
  assert.deepEqual(config.missing, ['WOO_STORE_URL', 'WOO_CONSUMER_KEY', 'WOO_CONSUMER_SECRET'])
})

test('readWooConfig trims values, strips trailing slashes and flags invalid URLs', () => {
  const config = readWooConfig(VALID_ENV)
  assert.equal(config.configured, true)
  assert.equal(config.storeUrl, 'https://shop.example.com')
  assert.deepEqual(config.missing, [])
  assert.equal(config.urlError, null)

  const invalid = readWooConfig({ ...VALID_ENV, WOO_STORE_URL: 'shop.example.com' })
  assert.equal(invalid.configured, false)
  assert.equal(invalid.invalidUrl, true)
  assert.match(invalid.urlError, /not a valid URL/)
})

test('readWooConfig requires HTTPS for remote stores', () => {
  const config = readWooConfig({ ...VALID_ENV, WOO_STORE_URL: 'http://shop.example.com' })
  assert.equal(config.configured, false)
  assert.equal(config.invalidUrl, true)
  assert.match(config.urlError, /must use HTTPS/)
})

test('readWooConfig rejects plain HTTP on localhost unless explicitly allowed', () => {
  const rejected = readWooConfig({ ...VALID_ENV, WOO_STORE_URL: 'http://localhost:8099' })
  assert.equal(rejected.configured, false)
  assert.match(rejected.urlError, /WOO_ALLOW_LOCAL_HTTP=1/)

  const allowed = readWooConfig({
    ...VALID_ENV,
    WOO_STORE_URL: 'http://localhost:8099',
    WOO_ALLOW_LOCAL_HTTP: '1',
  })
  assert.equal(allowed.configured, true)
  assert.equal(allowed.insecureLocal, true)
  assert.equal(allowed.urlError, null)

  const remoteWithFlag = readWooConfig({
    ...VALID_ENV,
    WOO_STORE_URL: 'http://shop.example.com',
    WOO_ALLOW_LOCAL_HTTP: '1',
  })
  assert.equal(remoteWithFlag.configured, false)
  assert.match(remoteWithFlag.urlError, /only allowed for a local development host/)
})

test('plain HTTP is allowed for local-development hosts only when enabled', () => {
  const localUrls = [
    'http://pim-test-store.local',
    'http://my-site.test',
    'http://app.localhost',
    'http://127.0.0.5:8080',
    'http://192.168.1.50',
    'http://10.0.0.8:8099',
    'http://172.20.10.4',
  ]
  for (const url of localUrls) {
    const config = readWooConfig({ ...VALID_ENV, WOO_STORE_URL: url, WOO_ALLOW_LOCAL_HTTP: '1' })
    assert.equal(config.configured, true, url)
    assert.equal(config.insecureLocal, true, url)
    assert.equal(config.urlError, null, url)
  }

  for (const url of ['http://pim-test-store.local', 'http://192.168.1.50']) {
    const config = readWooConfig({ ...VALID_ENV, WOO_STORE_URL: url })
    assert.equal(config.configured, false, url)
    assert.match(config.urlError, /WOO_ALLOW_LOCAL_HTTP=1/, url)
  }

  const remoteUrls = ['http://public.example.com', 'http://8.8.8.8', 'http://172.40.1.1', 'http://pim-test-store.local.com']
  for (const url of remoteUrls) {
    const config = readWooConfig({ ...VALID_ENV, WOO_STORE_URL: url, WOO_ALLOW_LOCAL_HTTP: '1' })
    assert.equal(config.configured, false, url)
    assert.match(config.urlError, /must use HTTPS/, url)
  }

  for (const url of ['https://pim-test-store.local', 'https://192.168.1.50']) {
    const config = readWooConfig({ ...VALID_ENV, WOO_STORE_URL: url })
    assert.equal(config.configured, true, url)
    assert.equal(config.insecureLocal, false, url)
  }
})

test('readWooConfig rejects unsupported protocols', () => {
  const config = readWooConfig({ ...VALID_ENV, WOO_STORE_URL: 'ftp://shop.example.com' })
  assert.equal(config.configured, false)
  assert.match(config.urlError, /https/)
})

test('publicStatus never exposes credentials and reports URL diagnostics', () => {
  const config = readWooConfig(VALID_ENV)
  const serialized = JSON.stringify(publicStatus(config))
  assert.equal(serialized.includes('ck_test'), false)
  assert.equal(serialized.includes('cs_test'), false)
  assert.deepEqual(JSON.parse(serialized), {
    configured: true,
    storeHost: 'shop.example.com',
    missing: [],
    invalidUrl: false,
    urlError: null,
    insecureLocal: false,
  })
})

test('wooUrlFor targets the WooCommerce v3 products endpoint', () => {
  const config = readWooConfig(VALID_ENV)
  assert.equal(wooUrlFor(config, '/777'), 'https://shop.example.com/wp-json/wc/v3/products/777')
})

// ---------- Upstream requests ----------

test('handleWooRequest attaches Basic auth server-side and forwards the payload', async () => {
  const { impl, calls } = captureFetch(jsonResponse(201, { id: 42 }))
  const config = readWooConfig(VALID_ENV)
  const result = await handleWooRequest({
    config,
    method: 'POST',
    body: { name: 'Test', sku: 'KIL-1' },
    fetchImpl: impl,
  })

  assert.equal(result.status, 200)
  assert.equal(result.payload.ok, true)
  assert.equal(result.payload.product.id, 42)
  assert.equal(calls[0].url, 'https://shop.example.com/wp-json/wc/v3/products')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers.Authorization, `Basic ${btoa('ck_test:cs_test')}`)
  assert.deepEqual(JSON.parse(calls[0].options.body), { name: 'Test', sku: 'KIL-1' })
})

test('handleWooRequest forwards query strings for sku lookups', async () => {
  const { impl, calls } = captureFetch(jsonResponse(200, [{ id: 9 }]))
  const config = readWooConfig(VALID_ENV)
  await handleWooRequest({ config, method: 'GET', query: '?sku=KIL-1001&per_page=1', fetchImpl: impl })
  assert.equal(calls[0].url, 'https://shop.example.com/wp-json/wc/v3/products?sku=KIL-1001&per_page=1')
  assert.equal(calls[0].options.body, undefined)
})

test('handleWooRequest creates missing categories and sends term ids', async () => {
  const calls = []
  const impl = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.includes('/products/categories?slug=apparel')) return jsonResponse(200, [])
    if (url.endsWith('/products/categories')) return jsonResponse(201, { id: 42, name: 'Apparel' })
    return jsonResponse(201, { id: 7 })
  }
  const result = await handleWooRequest({
    config: readWooConfig(VALID_ENV),
    method: 'POST',
    body: { name: 'Tee', categories: [{ name: 'Apparel' }] },
    fetchImpl: impl,
  })

  assert.equal(result.status, 200)
  assert.equal(calls[0].url, 'https://shop.example.com/wp-json/wc/v3/products/categories?slug=apparel&per_page=1')
  assert.equal(calls[1].url, 'https://shop.example.com/wp-json/wc/v3/products/categories')
  assert.deepEqual(JSON.parse(calls[1].options.body), { name: 'Apparel' })
  assert.equal(calls[2].url, 'https://shop.example.com/wp-json/wc/v3/products')
  assert.deepEqual(JSON.parse(calls[2].options.body).categories, [{ id: 42 }])
})

test('handleWooRequest reuses an existing category instead of creating one', async () => {
  const calls = []
  const impl = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.includes('/products/categories?slug=')) return jsonResponse(200, [{ id: 3, name: 'Apparel' }])
    return jsonResponse(201, { id: 7 })
  }
  const result = await handleWooRequest({
    config: readWooConfig(VALID_ENV),
    method: 'PUT',
    path: '/123',
    body: { name: 'Tee', categories: [{ name: 'Apparel' }] },
    fetchImpl: impl,
  })

  assert.equal(result.status, 200)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url, 'https://shop.example.com/wp-json/wc/v3/products/123')
  assert.deepEqual(JSON.parse(calls[1].options.body).categories, [{ id: 3 }])
})

test('handleWooRequest surfaces category resolution failures without writing the product', async () => {
  const calls = []
  const impl = async (url, options = {}) => {
    calls.push({ url, options })
    return jsonResponse(500, { code: 'woocommerce_rest_cannot_create', message: 'Category denied' })
  }
  const result = await handleWooRequest({
    config: readWooConfig(VALID_ENV),
    method: 'POST',
    body: { name: 'Tee', categories: [{ name: 'Apparel' }] },
    fetchImpl: impl,
  })

  assert.equal(result.status, 500)
  assert.equal(result.payload.ok, false)
  assert.equal(result.payload.error, 'Category denied')
  assert.equal(result.payload.code, 'woocommerce_rest_cannot_create')
  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.includes('/products/categories?slug=apparel'))
})

test('handleWooRequest passes numeric category ids straight through', async () => {
  const { impl, calls } = captureFetch(jsonResponse(201, { id: 9 }))
  await handleWooRequest({
    config: readWooConfig(VALID_ENV),
    method: 'POST',
    body: { name: 'Tee', categories: [{ id: 5 }] },
    fetchImpl: impl,
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(JSON.parse(calls[0].options.body).categories, [{ id: 5 }])
})

test('handleWooRequest applies a timeout signal to upstream requests', async () => {
  const { impl, calls } = captureFetch(jsonResponse(200, []))
  const config = readWooConfig(VALID_ENV)
  await handleWooRequest({ config, method: 'GET', fetchImpl: impl, timeoutMs: 1234 })
  assert.ok(calls[0].options.signal instanceof AbortSignal)
})

test('handleWooRequest maps store timeouts to 504', async () => {
  const impl = async () => {
    const error = new Error('The operation was aborted due to timeout')
    error.name = 'TimeoutError'
    throw error
  }
  const config = readWooConfig(VALID_ENV)
  const result = await handleWooRequest({ config, method: 'GET', fetchImpl: impl, timeoutMs: 15000 })
  assert.equal(result.status, 504)
  assert.equal(result.payload.code, 'proxy_timeout')
  assert.match(result.payload.error, /did not respond within 15 seconds/)
})

test('handleWooRequest maps store errors to the proxy response', async () => {
  const { impl } = captureFetch(jsonResponse(404, { message: 'Not found', code: 'woocommerce_rest_invalid_id' }))
  const config = readWooConfig(VALID_ENV)
  const result = await handleWooRequest({ config, method: 'PUT', path: '/999', body: {}, fetchImpl: impl })
  assert.equal(result.status, 404)
  assert.deepEqual(result.payload, { ok: false, error: 'Not found', code: 'woocommerce_rest_invalid_id' })
})

test('handleWooRequest reports network failures as 502', async () => {
  const impl = async () => {
    throw new TypeError('Failed to fetch')
  }
  const config = readWooConfig(VALID_ENV)
  const result = await handleWooRequest({ config, method: 'GET', fetchImpl: impl })
  assert.equal(result.status, 502)
  assert.equal(result.payload.code, 'proxy_network_error')
  assert.match(result.payload.error, /Failed to fetch/)
})

test('handleWooRequest refuses to call the store when unconfigured', async () => {
  const { impl, calls } = captureFetch(jsonResponse(200, {}))
  const result = await handleWooRequest({ config: readWooConfig({}), method: 'GET', fetchImpl: impl })
  assert.equal(result.status, 503)
  assert.equal(result.payload.code, 'proxy_not_configured')
  assert.match(result.payload.error, /WOO_STORE_URL/)
  assert.equal(calls.length, 0)
})

test('handleWooRequest surfaces URL errors when unconfigured', async () => {
  const { impl, calls } = captureFetch(jsonResponse(200, {}))
  const config = readWooConfig({ ...VALID_ENV, WOO_STORE_URL: 'http://shop.example.com' })
  const result = await handleWooRequest({ config, method: 'GET', fetchImpl: impl })
  assert.equal(result.status, 503)
  assert.match(result.payload.error, /must use HTTPS/)
  assert.equal(calls.length, 0)
})

// ---------- Middleware routing + auth ----------

test('the middleware ignores non-proxy routes', async () => {
  const middleware = createTestMiddleware()
  const { nextCalled } = await runMiddleware(middleware, { url: '/' })
  assert.equal(nextCalled, true)
})

test('the middleware serves the status route without store credentials and issues a session cookie', async () => {
  const middleware = createWooMiddleware({ env: {}, fetchImpl: async () => jsonResponse(200, {}), sessionToken: TEST_TOKEN })
  const { res, json, nextCalled } = await runMiddleware(middleware, { url: '/api/woo/status', headers: { cookie: '' } })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 200)
  assert.equal(json.configured, false)
  assert.deepEqual(json.missing, ['WOO_STORE_URL', 'WOO_CONSUMER_KEY', 'WOO_CONSUMER_SECRET'])
  assert.match(res.headers['Set-Cookie'], new RegExp(`^${SESSION_COOKIE}=${TEST_TOKEN}`))
  assert.match(res.headers['Set-Cookie'], /HttpOnly/)
  assert.match(res.headers['Set-Cookie'], /SameSite=Strict/)
})

test('product routes reject requests without the session cookie', async () => {
  let fetched = false
  const middleware = createTestMiddleware({
    fetchImpl: async () => {
      fetched = true
      return jsonResponse(200, [])
    },
  })
  const { res, json } = await runMiddleware(middleware, { url: '/api/woo/products?sku=KIL-1', headers: { cookie: '' } })
  assert.equal(res.statusCode, 401)
  assert.equal(json.code, 'proxy_unauthorized')
  assert.equal(fetched, false)

  const wrong = await runMiddleware(middleware, { url: '/api/woo/products?sku=KIL-1', headers: { cookie: `${SESSION_COOKIE}=someone-else` } })
  assert.equal(wrong.res.statusCode, 401)
})

test('product routes reject cross-origin requests', async () => {
  const middleware = createTestMiddleware()
  const { res, json } = await runMiddleware(middleware, {
    url: '/api/woo/products?sku=KIL-1',
    headers: { origin: 'https://evil.example.com' },
  })
  assert.equal(res.statusCode, 403)
  assert.equal(json.code, 'proxy_forbidden')

  const sameOrigin = await runMiddleware(middleware, {
    url: '/api/woo/products?sku=KIL-1',
    headers: { origin: 'http://localhost:5173' },
  })
  assert.notEqual(sameOrigin.res.statusCode, 403)
})

test('the proxy rejects preflight OPTIONS requests', async () => {
  const middleware = createTestMiddleware()
  const { res, json } = await runMiddleware(middleware, { method: 'OPTIONS', url: '/api/woo/products' })
  assert.equal(res.statusCode, 403)
  assert.equal(json.code, 'proxy_forbidden')
})

test('write routes require the X-PIM-Sync header', async () => {
  const middleware = createTestMiddleware()
  const { res, json } = await runMiddleware(middleware, {
    method: 'POST',
    url: '/api/woo/products',
    body: { sku: 'KIL-1' },
    headers: { 'x-pim-sync': '' },
  })
  assert.equal(res.statusCode, 401)
  assert.equal(json.code, 'proxy_unauthorized')
})

test('the middleware normalises sku lookups to a single product', async () => {
  const middleware = createWooMiddleware({
    env: VALID_ENV,
    fetchImpl: async () => jsonResponse(200, [{ id: 1 }, { id: 2 }]),
    sessionToken: TEST_TOKEN,
  })
  const { res, json } = await runMiddleware(middleware, { url: '/api/woo/products?sku=KIL-1' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(json.product, { id: 1 })

  const empty = createWooMiddleware({ env: VALID_ENV, fetchImpl: async () => jsonResponse(200, []), sessionToken: TEST_TOKEN })
  const result = await runMiddleware(empty, { url: '/api/woo/products?sku=missing' })
  assert.equal(result.json.product, null)
})

test('the middleware rejects sku lookups without a sku parameter', async () => {
  let fetched = false
  const middleware = createTestMiddleware({
    fetchImpl: async () => {
      fetched = true
      return jsonResponse(200, [])
    },
  })
  const { res, json } = await runMiddleware(middleware, { url: '/api/woo/products' })
  assert.equal(res.statusCode, 400)
  assert.equal(json.code, 'proxy_missing_sku')
  assert.equal(fetched, false)
})

test('the middleware PUTs products by numeric id only', async () => {
  const middleware = createTestMiddleware({ fetchImpl: async () => jsonResponse(200, { id: 777 }) })
  const { res, json } = await runMiddleware(middleware, {
    method: 'PUT',
    url: '/api/woo/products/777',
    body: { sku: 'KIL-1' },
  })
  assert.equal(res.statusCode, 200)
  assert.equal(json.product.id, 777)

  const invalid = await runMiddleware(middleware, { method: 'PUT', url: '/api/woo/products/abc', body: {} })
  assert.equal(invalid.res.statusCode, 404)
})

test('the middleware rejects malformed JSON bodies', async () => {
  const middleware = createTestMiddleware()
  const { res, json } = await runMiddleware(middleware, {
    method: 'POST',
    url: '/api/woo/products',
    body: '{not json',
  })
  assert.equal(res.statusCode, 400)
  assert.equal(json.code, 'proxy_bad_request')
})

test('the middleware rejects oversized bodies', async () => {
  const middleware = createTestMiddleware()
  const { res, json } = await runMiddleware(middleware, {
    method: 'POST',
    url: '/api/woo/products',
    body: 'x'.repeat(1024 * 1024 + 1),
  })
  assert.equal(res.statusCode, 413)
  assert.equal(json.code, 'proxy_bad_request')
})

test('the middleware returns 404 for unknown proxy routes', async () => {
  const middleware = createTestMiddleware()
  const { res, json } = await runMiddleware(middleware, { url: '/api/woo/orders' })
  assert.equal(res.statusCode, 404)
  assert.equal(json.code, 'proxy_not_found')
})
