import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SYNC_MODES,
  WOO_SIMULATION_NOTICE,
  LIVE_MODE_WARNING,
  buildSyncPayload,
  fetchLiveStatus,
  findProductBySku,
  isSyncMode,
  liveBlockReason,
  markSyncError,
  pushProductToLiveStore,
  pushProductToSimulatedStore,
  wooIdFromSku,
} from '../src/lib/woo.js'
import { createProduct } from '../src/lib/products.js'

function sampleProduct() {
  return createProduct({
    name: 'Aurora Desk Lamp',
    sku: 'KIL-1001',
    category: 'Lighting',
    price: '59',
    stock: '24',
    status: 'published',
    description: 'Warm LED lamp',
    color: 'Pebble',
    size: 'Medium',
    material: 'Powder-coated steel',
    attributes: [{ id: 'attr_1', name: 'Finish', values: ['Matte', 'Gloss'] }],
  })
}

function createFetchMock(sequence) {
  const calls = []
  const queue = [...sequence]
  const impl = async (url, options = {}) => {
    const next = queue.shift() ?? { status: 500, data: null }
    calls.push({
      url,
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      body: options.body,
      credentials: options.credentials,
      cache: options.cache,
    })
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.data,
    }
  }
  return { impl, calls }
}

test('the simulated demo mode is explicitly disclosed', () => {
  assert.match(WOO_SIMULATION_NOTICE, /simulated/i)
  assert.match(WOO_SIMULATION_NOTICE, /no network requests/i)
  assert.equal(SYNC_MODES.simulated.id, 'simulated')
  assert.equal(SYNC_MODES.live.id, 'live')
  assert.ok(isSyncMode('live'))
  assert.equal(isSyncMode('anything-else'), false)
})

test('live mode is labelled as untested and points credentials at the server', () => {
  assert.match(LIVE_MODE_WARNING, /not been exercised against a real store/i)
  assert.match(LIVE_MODE_WARNING, /environment variables/i)
  assert.match(LIVE_MODE_WARNING, /never reach the browser/i)
})

test('wooIdFromSku is deterministic and varies per sku', () => {
  const first = wooIdFromSku('KIL-1001')
  assert.equal(first, wooIdFromSku('kil-1001'))
  assert.notEqual(first, wooIdFromSku('KIL-1002'))
  assert.ok(first >= 100000 && first <= 999999)
})

test('buildSyncPayload maps the product into a WooCommerce-shaped payload', () => {
  const payload = buildSyncPayload(sampleProduct())
  assert.equal(payload.sku, 'KIL-1001')
  assert.equal(payload.regular_price, '59.00')
  assert.equal(payload.stock_quantity, 24)
  assert.equal(payload.manage_stock, true)
  assert.equal(payload.status, 'publish')
  assert.deepEqual(payload.categories, [{ name: 'Lighting' }])
  assert.deepEqual(payload.attributes, [
    { name: 'Color', options: ['Pebble'], visible: true },
    { name: 'Size', options: ['Medium'], visible: true },
    { name: 'Material', options: ['Powder-coated steel'], visible: true },
    { name: 'Finish', options: ['Matte', 'Gloss'], visible: true },
  ])
})

test('buildSyncPayload omits blank structured attributes', () => {
  const payload = buildSyncPayload(createProduct({ name: 'Test', sku: 'KIL-9', category: 'Accessories', price: '1', stock: '1' }))
  assert.deepEqual(payload.attributes, [])
})

test('pushProductToSimulatedStore marks a product synced with a demo id and timestamp', async () => {
  const result = await pushProductToSimulatedStore(sampleProduct(), { delay: 0 })
  assert.equal(result.syncStatus, 'synced')
  assert.equal(result.syncError, null)
  assert.equal(result.wooId, wooIdFromSku('KIL-1001'))
  assert.equal(result.lastSyncMode, 'simulated')
  assert.ok(Date.parse(result.lastSyncedAt) > 0)
})

test('pushProductToSimulatedStore keeps an existing woo id on re-sync', async () => {
  const product = { ...sampleProduct(), wooId: 100241, syncStatus: 'pending' }
  const result = await pushProductToSimulatedStore(product, { delay: 0 })
  assert.equal(result.wooId, 100241)
  assert.equal(result.syncStatus, 'synced')
})

test('pushProductToSimulatedStore can simulate a failed request', async () => {
  await assert.rejects(
    () => pushProductToSimulatedStore(sampleProduct(), { delay: 0, fail: true }),
    /Simulated WooCommerce request failed/,
  )
})

test('pushProductToLiveStore POSTs a new product through the local proxy without credentials', async () => {
  const { impl, calls } = createFetchMock([{ status: 201, data: { ok: true, product: { id: 555001 }, storeStatus: 201 } }])
  const result = await pushProductToLiveStore(sampleProduct(), { fetchImpl: impl })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/woo/products')
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].headers.Authorization, undefined)
  assert.equal(calls[0].headers['X-PIM-Sync'], '1')
  assert.equal(calls[0].credentials, 'same-origin')
  assert.equal(JSON.parse(calls[0].body).sku, 'KIL-1001')
  assert.equal(result.syncStatus, 'synced')
  assert.equal(result.wooId, 555001)
  assert.equal(result.lastSyncMode, 'live')
  assert.ok(Date.parse(result.lastSyncedAt) > 0)
})

test('pushProductToLiveStore PUTs an existing product to its store id', async () => {
  const { impl, calls } = createFetchMock([{ status: 200, data: { ok: true, product: { id: 777 }, storeStatus: 200 } }])
  const product = { ...sampleProduct(), wooId: 777 }
  const result = await pushProductToLiveStore(product, { fetchImpl: impl })

  assert.equal(calls[0].url, '/api/woo/products/777')
  assert.equal(calls[0].method, 'PUT')
  assert.equal(result.wooId, 777)
})

test('pushProductToLiveStore adopts an existing store product when the SKU already exists', async () => {
  const { impl, calls } = createFetchMock([
    { status: 400, data: { ok: false, error: 'Invalid or duplicated SKU.', code: 'product_invalid_sku' } },
    { status: 200, data: { ok: true, product: { id: 555 }, storeStatus: 200 } },
    { status: 200, data: { ok: true, product: { id: 555 }, storeStatus: 200 } },
  ])
  const result = await pushProductToLiveStore(sampleProduct(), { fetchImpl: impl })

  assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET', 'PUT'])
  assert.equal(calls[1].url, '/api/woo/products?sku=KIL-1001')
  assert.equal(calls[2].url, '/api/woo/products/555')
  assert.equal(result.syncStatus, 'synced')
  assert.equal(result.wooId, 555)
})

test('pushProductToLiveStore rethrows the SKU conflict when no store product matches', async () => {
  const { impl, calls } = createFetchMock([
    { status: 400, data: { ok: false, error: 'Invalid or duplicated SKU.', code: 'product_invalid_sku' } },
    { status: 200, data: { ok: false, error: 'not found', code: 'woo_api_error' } },
  ])
  await assert.rejects(() => pushProductToLiveStore(sampleProduct(), { fetchImpl: impl }), /duplicated SKU/)
  assert.equal(calls.length, 2)
})

test('pushProductToLiveStore surfaces store errors with their code', async () => {
  const { impl } = createFetchMock([
    { status: 401, data: { ok: false, error: 'Invalid signature', code: 'woocommerce_rest_authentication_error' } },
  ])
  await assert.rejects(
    () => pushProductToLiveStore(sampleProduct(), { fetchImpl: impl }),
    (error) => {
      assert.match(error.message, /Invalid signature/)
      assert.equal(error.code, 'woocommerce_rest_authentication_error')
      assert.equal(error.status, 401)
      return true
    },
  )
})

test('pushProductToLiveStore reports an unreachable proxy', async () => {
  const impl = async () => {
    throw new TypeError('Failed to fetch')
  }
  await assert.rejects(() => pushProductToLiveStore(sampleProduct(), { fetchImpl: impl }), /not reachable/)
})

test('fetchLiveStatus reports server configuration without any secrets', async () => {
  const { impl } = createFetchMock([
    { status: 200, data: { configured: true, storeHost: 'shop.example.com', missing: [], invalidUrl: false } },
  ])
  const status = await fetchLiveStatus({ fetchImpl: impl })
  assert.equal(status.configured, true)
  assert.equal(status.storeHost, 'shop.example.com')
  assert.deepEqual(status.missing, [])
  assert.equal(status.error, null)
})

test('fetchLiveStatus degrades gracefully when the proxy is unreachable', async () => {
  const status = await fetchLiveStatus({
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch')
    },
  })
  assert.equal(status.configured, false)
  assert.match(status.error, /not reachable/)
})

test('findProductBySku encodes the sku in the proxy query', async () => {
  const { impl, calls } = createFetchMock([{ status: 200, data: { ok: true, product: { id: 9 }, storeStatus: 200 } }])
  const product = await findProductBySku('KIL 1001', { fetchImpl: impl })
  assert.equal(calls[0].url, '/api/woo/products?sku=KIL%201001')
  assert.equal(product.id, 9)
})

test('markSyncError records the failure reason', () => {
  const failed = markSyncError(sampleProduct(), 'Simulated WooCommerce request failed (forced failure).')
  assert.equal(failed.syncStatus, 'error')
  assert.match(failed.syncError, /forced failure/)
})

test('live requests surface proxy authentication errors', async () => {
  const { impl } = createFetchMock([
    {
      status: 401,
      data: {
        ok: false,
        error: 'The sync proxy only accepts requests from this app session. Reload the app.',
        code: 'proxy_unauthorized',
      },
    },
  ])
  await assert.rejects(
    () => pushProductToLiveStore(sampleProduct(), { fetchImpl: impl }),
    (error) => {
      assert.equal(error.code, 'proxy_unauthorized')
      assert.equal(error.status, 401)
      assert.match(error.message, /app session/)
      return true
    },
  )
})

test('fetchLiveStatus reports URL diagnostics without secrets', async () => {
  const { impl, calls } = createFetchMock([
    {
      status: 200,
      data: {
        configured: false,
        storeHost: 'localhost:8099',
        missing: [],
        invalidUrl: true,
        urlError: 'WOO_STORE_URL must use HTTPS for remote stores.',
        insecureLocal: false,
      },
    },
  ])
  const status = await fetchLiveStatus({ fetchImpl: impl })
  assert.equal(status.configured, false)
  assert.equal(status.invalidUrl, true)
  assert.match(status.urlError, /must use HTTPS/)
  assert.equal(status.insecureLocal, false)
  assert.equal(calls[0].cache, 'no-store')
  assert.equal(calls[0].credentials, 'same-origin')
})

test('fetchLiveStatus surfaces the insecure-local flag', async () => {
  const { impl } = createFetchMock([
    {
      status: 200,
      data: { configured: true, storeHost: 'localhost:8099', missing: [], invalidUrl: false, urlError: null, insecureLocal: true },
    },
  ])
  const status = await fetchLiveStatus({ fetchImpl: impl })
  assert.equal(status.configured, true)
  assert.equal(status.insecureLocal, true)
})

test('liveBlockReason explains every blocked live state', () => {
  assert.match(liveBlockReason(null, true), /Still checking/)
  assert.match(liveBlockReason(null, false), /not been reachable/)
  assert.match(liveBlockReason({ error: 'boom' }, false), /unreachable/)
  assert.match(liveBlockReason({ configured: false, missing: ['WOO_STORE_URL'], urlError: null }, false), /Missing: WOO_STORE_URL/)
  assert.equal(
    liveBlockReason({ configured: false, missing: [], urlError: 'WOO_STORE_URL must use HTTPS.' }, false),
    'WOO_STORE_URL must use HTTPS.',
  )
  assert.equal(liveBlockReason({ configured: true, error: null }, false), null)
})
