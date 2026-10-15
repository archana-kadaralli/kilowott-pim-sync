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
  latestSuccessfulRun,
  liveBlockReason,
  markSyncError,
  pushProductToLiveStore,
  pushProductToSimulatedStore,
  validStoreId,
  wooIdFromSku,
} from '../src/lib/woo.js'
import { createProduct, seedProducts } from '../src/lib/products.js'

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

test('live mode is labelled with its verification status and points credentials at the server', () => {
  assert.match(LIVE_MODE_WARNING, /verified against a local WooCommerce test store/i)
  assert.match(LIVE_MODE_WARNING, /not been tested against a remote production store/i)
  assert.match(LIVE_MODE_WARNING, /environment variables/i)
  assert.match(LIVE_MODE_WARNING, /never reach the browser/i)
  assert.match(SYNC_MODES.live.tagline, /verified/i)
  assert.doesNotMatch(SYNC_MODES.live.tagline, /untested/i)
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

test('pushProductToLiveStore looks up the SKU first and POSTs a new product without credentials', async () => {
  const { impl, calls } = createFetchMock([
    { status: 200, data: { ok: true, product: null, storeStatus: 200 } },
    { status: 201, data: { ok: true, product: { id: 555001 }, storeStatus: 201 } },
  ])
  const result = await pushProductToLiveStore(sampleProduct(), { fetchImpl: impl })

  assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST'])
  assert.equal(calls[0].url, '/api/woo/products?sku=KIL-1001')
  assert.equal(calls[1].url, '/api/woo/products')
  assert.equal(calls[1].headers.Authorization, undefined)
  assert.equal(calls[1].headers['X-PIM-Sync'], '1')
  assert.equal(calls[1].credentials, 'same-origin')
  assert.equal(JSON.parse(calls[1].body).sku, 'KIL-1001')
  assert.equal(result.syncStatus, 'synced')
  assert.equal(result.wooId, 555001)
  assert.equal(result.lastSyncMode, 'live')
  assert.ok(Date.parse(result.lastSyncedAt) > 0)
})

test('pushProductToLiveStore PUTs a verified live id without a SKU lookup', async () => {
  const { impl, calls } = createFetchMock([{ status: 200, data: { ok: true, product: { id: 777 }, storeStatus: 200 } }])
  const product = { ...sampleProduct(), wooId: 777, lastSyncMode: 'live', syncStatus: 'synced' }
  const result = await pushProductToLiveStore(product, { fetchImpl: impl })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/woo/products/777')
  assert.equal(calls[0].method, 'PUT')
  assert.equal(result.wooId, 777)
  assert.equal(result.lastSyncMode, 'live')
})

test('pushProductToLiveStore updates the existing store product that matches the SKU', async () => {
  const { impl, calls } = createFetchMock([
    { status: 200, data: { ok: true, product: { id: 555 }, storeStatus: 200 } },
    { status: 200, data: { ok: true, product: { id: 555 }, storeStatus: 200 } },
  ])
  const result = await pushProductToLiveStore(sampleProduct(), { fetchImpl: impl })

  assert.deepEqual(calls.map((call) => call.method), ['GET', 'PUT'])
  assert.equal(calls[0].url, '/api/woo/products?sku=KIL-1001')
  assert.equal(calls[1].url, '/api/woo/products/555')
  assert.equal(result.syncStatus, 'synced')
  assert.equal(result.wooId, 555)
  assert.equal(result.lastSyncMode, 'live')
})

test('pushProductToLiveStore rethrows the SKU conflict when no store product matches', async () => {
  const { impl, calls } = createFetchMock([
    { status: 200, data: { ok: true, product: null, storeStatus: 200 } },
    { status: 400, data: { ok: false, error: 'Invalid or duplicated SKU.', code: 'product_invalid_sku' } },
    { status: 200, data: { ok: true, product: null, storeStatus: 200 } },
  ])
  await assert.rejects(() => pushProductToLiveStore(sampleProduct(), { fetchImpl: impl }), /duplicated SKU/)
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST', 'GET'])
})

test('validStoreId only accepts positive integers', () => {
  assert.equal(validStoreId(7), 7)
  assert.equal(validStoreId(0), null)
  assert.equal(validStoreId(-3), null)
  assert.equal(validStoreId(2.5), null)
  assert.equal(validStoreId('42'), null)
  assert.equal(validStoreId(null), null)
  assert.equal(validStoreId(undefined), null)
})

test('pushProductToLiveStore never reuses a seeded demo id as a live id', async () => {
  const mug = seedProducts().find((product) => product.sku === 'KIL-2004')
  assert.equal(mug.wooId, 100242)
  assert.equal(mug.lastSyncMode, 'simulated')

  const { impl, calls } = createFetchMock([
    { status: 200, data: { ok: true, product: null, storeStatus: 200 } },
    { status: 201, data: { ok: true, product: { id: 8801 }, storeStatus: 201 } },
  ])
  const result = await pushProductToLiveStore(mug, { fetchImpl: impl })

  assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST'])
  assert.equal(calls[0].url, '/api/woo/products?sku=KIL-2004')
  assert.ok(calls.every((call) => !call.url.includes('100242')))
  assert.equal(result.syncStatus, 'synced')
  assert.equal(result.wooId, 8801)
  assert.equal(result.lastSyncMode, 'live')
})

test('pushProductToLiveStore ignores demo ids recorded by simulated syncs', async () => {
  const demoId = wooIdFromSku('KIL-1001')
  const product = { ...sampleProduct(), wooId: demoId, lastSyncMode: 'simulated', syncStatus: 'synced' }
  const { impl, calls } = createFetchMock([
    { status: 200, data: { ok: true, product: { id: 321 }, storeStatus: 200 } },
    { status: 200, data: { ok: true, product: { id: 321 }, storeStatus: 200 } },
  ])
  const result = await pushProductToLiveStore(product, { fetchImpl: impl })

  assert.deepEqual(calls.map((call) => call.method), ['GET', 'PUT'])
  assert.equal(calls[0].url, '/api/woo/products?sku=KIL-1001')
  assert.ok(calls.every((call) => !call.url.includes(String(demoId))))
  assert.equal(result.wooId, 321)
  assert.equal(result.lastSyncMode, 'live')
})

test('pushProductToLiveStore recovers from a stale live id by adopting the SKU match', async () => {
  const product = { ...sampleProduct(), wooId: 4242, lastSyncMode: 'live', syncStatus: 'synced' }
  const { impl, calls } = createFetchMock([
    { status: 404, data: { ok: false, error: 'Invalid ID.', code: 'woocommerce_rest_product_invalid_id' } },
    { status: 200, data: { ok: true, product: { id: 555 }, storeStatus: 200 } },
    { status: 200, data: { ok: true, product: { id: 555 }, storeStatus: 200 } },
  ])
  const result = await pushProductToLiveStore(product, { fetchImpl: impl })

  assert.deepEqual(calls.map((call) => call.method), ['PUT', 'GET', 'PUT'])
  assert.equal(calls[0].url, '/api/woo/products/4242')
  assert.equal(calls[1].url, '/api/woo/products?sku=KIL-1001')
  assert.equal(calls[2].url, '/api/woo/products/555')
  assert.equal(result.syncStatus, 'synced')
  assert.equal(result.wooId, 555)
  assert.equal(result.lastSyncMode, 'live')
})

test('pushProductToLiveStore recreates by POST when the stale live id and the SKU are both absent', async () => {
  const product = { ...sampleProduct(), wooId: 4242, lastSyncMode: 'live', syncStatus: 'synced' }
  const { impl, calls } = createFetchMock([
    { status: 404, data: { ok: false, error: 'Invalid ID.' } },
    { status: 200, data: { ok: true, product: null, storeStatus: 200 } },
    { status: 201, data: { ok: true, product: { id: 9001 }, storeStatus: 201 } },
  ])
  const result = await pushProductToLiveStore(product, { fetchImpl: impl })

  assert.deepEqual(calls.map((call) => call.method), ['PUT', 'GET', 'POST'])
  assert.equal(result.wooId, 9001)
  assert.equal(result.lastSyncMode, 'live')
})

test('pushProductToLiveStore surfaces PUT failures that are not invalid ids without retrying', async () => {
  const product = { ...sampleProduct(), wooId: 777, lastSyncMode: 'live', syncStatus: 'synced' }
  const { impl, calls } = createFetchMock([
    { status: 401, data: { ok: false, error: 'Invalid signature', code: 'woocommerce_rest_authentication_error' } },
  ])
  await assert.rejects(() => pushProductToLiveStore(product, { fetchImpl: impl }), /Invalid signature/)
  assert.equal(calls.length, 1)
})

test('pushProductToLiveStore adopts the SKU match when a create loses a concurrent race', async () => {
  const { impl, calls } = createFetchMock([
    { status: 200, data: { ok: true, product: null, storeStatus: 200 } },
    { status: 400, data: { ok: false, error: 'Invalid or duplicated SKU.', code: 'product_invalid_sku' } },
    { status: 200, data: { ok: true, product: { id: 555 }, storeStatus: 200 } },
    { status: 200, data: { ok: true, product: { id: 555 }, storeStatus: 200 } },
  ])
  const result = await pushProductToLiveStore(sampleProduct(), { fetchImpl: impl })

  assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST', 'GET', 'PUT'])
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1)
  assert.equal(result.wooId, 555)
})

test('pushProductToLiveStore only sends positive integer ids in PUT paths', async () => {
  for (const badId of [0, -12, '777', 12.5, null]) {
    const product = { ...sampleProduct(), wooId: badId, lastSyncMode: 'live' }
    const { impl, calls } = createFetchMock([
      { status: 200, data: { ok: true, product: { id: '555' }, storeStatus: 200 } },
      { status: 201, data: { ok: true, product: { id: 556 }, storeStatus: 201 } },
    ])
    const result = await pushProductToLiveStore(product, { fetchImpl: impl })
    assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST'], `bad id ${badId}`)
    assert.ok(calls.every((call) => !call.url.includes('/products/')), `bad id ${badId} reached a PUT path`)
    assert.equal(result.wooId, 556)
  }
})

test('pushProductToLiveStore keeps a verified live id when the update response omits it', async () => {
  const product = { ...sampleProduct(), wooId: 777, lastSyncMode: 'live', syncStatus: 'synced' }
  const { impl } = createFetchMock([{ status: 200, data: { ok: true, product: {}, storeStatus: 200 } }])
  const result = await pushProductToLiveStore(product, { fetchImpl: impl })
  assert.equal(result.wooId, 777)
  assert.equal(result.lastSyncMode, 'live')
})

test('pushProductToLiveStore refuses to mark a product synced when a create returns no id', async () => {
  const { impl } = createFetchMock([
    { status: 200, data: { ok: true, product: null, storeStatus: 200 } },
    { status: 201, data: { ok: true, product: {}, storeStatus: 201 } },
  ])
  await assert.rejects(
    () => pushProductToLiveStore(sampleProduct(), { fetchImpl: impl }),
    /did not return a product ID/,
  )
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

function logEntry({ id, at, outcome, mode, message = 'Store accepted the request' }) {
  return { id, at, outcome, mode, name: 'Kilowott Ceramic Mug', sku: 'KIL-2004', message }
}

test('latestSuccessfulRun picks the most recent success across mixed simulated and live history', () => {
  const syncLog = [
    logEntry({ id: 'live-new', at: '2026-10-15T10:00:00.000Z', outcome: 'success', mode: 'live' }),
    logEntry({ id: 'sim-mid', at: '2026-10-15T09:30:00.000Z', outcome: 'success', mode: 'simulated' }),
    logEntry({ id: 'live-old', at: '2026-10-15T09:00:00.000Z', outcome: 'success', mode: 'live' }),
    logEntry({ id: 'sim-old', at: '2026-10-15T08:30:00.000Z', outcome: 'success', mode: 'simulated' }),
  ]
  const latest = latestSuccessfulRun(syncLog)
  assert.equal(latest.id, 'live-new')
  assert.equal(latest.mode, 'live')
  assert.equal(latest.at, '2026-10-15T10:00:00.000Z')
  assert.equal(latestSuccessfulRun(syncLog, 'live').id, 'live-new')
  assert.equal(latestSuccessfulRun(syncLog, 'simulated').id, 'sim-mid')
})

test('latestSuccessfulRun returns a simulated success that happened after a live one', () => {
  const syncLog = [
    logEntry({ id: 'sim-new', at: '2026-10-15T10:00:00.000Z', outcome: 'success', mode: 'simulated' }),
    logEntry({ id: 'live-old', at: '2026-10-15T09:00:00.000Z', outcome: 'success', mode: 'live' }),
  ]
  assert.equal(latestSuccessfulRun(syncLog).id, 'sim-new')
  assert.equal(latestSuccessfulRun(syncLog).mode, 'simulated')
  assert.equal(latestSuccessfulRun(syncLog, 'live').id, 'live-old')
})

test('latestSuccessfulRun depends on timestamps, not on storage order', () => {
  const ascending = [
    logEntry({ id: 'sim-old', at: '2026-10-15T08:00:00.000Z', outcome: 'success', mode: 'simulated' }),
    logEntry({ id: 'live-mid', at: '2026-10-15T09:00:00.000Z', outcome: 'success', mode: 'live' }),
    logEntry({ id: 'sim-new', at: '2026-10-15T10:00:00.000Z', outcome: 'success', mode: 'simulated' }),
  ]
  assert.equal(latestSuccessfulRun(ascending).id, 'sim-new')
  assert.equal(latestSuccessfulRun([...ascending].reverse()).id, 'sim-new')
})

test('latestSuccessfulRun never lets a failed run replace the last success', () => {
  const syncLog = [
    logEntry({ id: 'live-fail', at: '2026-10-15T11:00:00.000Z', outcome: 'error', mode: 'live', message: 'Invalid ID.' }),
    logEntry({ id: 'sim-fail', at: '2026-10-15T10:30:00.000Z', outcome: 'error', mode: 'simulated' }),
    logEntry({ id: 'live-ok', at: '2026-10-15T09:00:00.000Z', outcome: 'success', mode: 'live' }),
  ]
  const latest = latestSuccessfulRun(syncLog)
  assert.equal(latest.id, 'live-ok')
  assert.equal(latest.outcome, 'success')
  assert.equal(latestSuccessfulRun(syncLog, 'simulated'), null)
})

test('latestSuccessfulRun ignores empty and malformed history', () => {
  assert.equal(latestSuccessfulRun([]), null)
  assert.equal(latestSuccessfulRun(), null)
  assert.equal(latestSuccessfulRun(null), null)
  assert.equal(latestSuccessfulRun([null, undefined, 'nope', { outcome: 'success' }]), null)
  assert.equal(latestSuccessfulRun([logEntry({ id: 'bad-time', at: 'not-a-date', outcome: 'success', mode: 'live' })]), null)
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
