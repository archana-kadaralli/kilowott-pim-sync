import test from 'node:test'
import assert from 'node:assert/strict'
import {
  loadProducts,
  loadSyncLog,
  loadSyncMode,
  purgeLegacyConnectionSettings,
  saveProducts,
  saveSyncLog,
  saveSyncMode,
} from '../src/lib/storage.js'

const PRODUCTS_KEY = 'kilowott-pim-sync/products/v1'
const SYNC_LOG_KEY = 'kilowott-pim-sync/sync-log/v1'
const SYNC_MODE_KEY = 'kilowott-pim-sync/sync-mode/v1'
const LEGACY_SETTINGS_KEY = 'kilowott-pim-sync/connection/v1'

function makeFakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value))
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

function withBrowserStorage(initial, run) {
  const fake = makeFakeStorage(initial)
  const previousWindow = globalThis.window
  globalThis.window = { localStorage: fake }
  try {
    return run(fake)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
}

test('loadProducts falls back to seed data when the browser has no storage', () => {
  const products = loadProducts()
  assert.equal(products.length, 6)
  assert.ok(products.every((product) => Array.isArray(product.attributes)))
})

test('loadProducts hydrates records saved by older versions of the app', () => {
  const legacy = [{ id: 'p1', name: 'Legacy', sku: 'KIL-1', category: 'Accessories', price: 10, stock: 2 }]
  withBrowserStorage({ [PRODUCTS_KEY]: JSON.stringify(legacy) }, () => {
    const [product] = loadProducts()
    assert.equal(product.name, 'Legacy')
    assert.equal(product.color, '')
    assert.equal(product.syncStatus, 'pending')
    assert.equal(product.wooId, null)
    assert.equal(product.lastSyncedAt, null)
    assert.deepEqual(product.attributes, [])
    assert.ok(product.createdAt)
    assert.ok(product.updatedAt)
  })
})

test('loadProducts falls back to seeds when stored JSON is corrupted', () => {
  withBrowserStorage({ [PRODUCTS_KEY]: '{not json' }, () => {
    assert.equal(loadProducts().length, 6)
  })
  withBrowserStorage({ [PRODUCTS_KEY]: '"a string"' }, () => {
    assert.equal(loadProducts().length, 6)
  })
})

test('loadProducts drops malformed records and repairs unsafe field values', () => {
  const stored = [
    null,
    'nonsense',
    42,
    {
      id: 'p1',
      name: 'Broken',
      sku: 'KIL-1',
      price: 'abc',
      stock: -5,
      status: 'weird',
      syncStatus: 'sideways',
      syncError: 12345,
      attributes: 'nope',
      wooId: 'abc',
    },
  ]
  withBrowserStorage({ [PRODUCTS_KEY]: JSON.stringify(stored) }, () => {
    const products = loadProducts()
    assert.equal(products.length, 1)
    const [product] = products
    assert.equal(product.price, 0)
    assert.equal(product.stock, 0)
    assert.equal(product.status, 'draft')
    assert.equal(product.syncStatus, 'pending')
    assert.equal(product.syncError, null)
    assert.equal(product.wooId, null)
    assert.equal(product.category, 'Uncategorized')
    assert.equal(product.lastSyncMode, null)
    assert.deepEqual(product.attributes, [])
  })
})

test('loadProducts keeps valid sync modes and drops unknown ones', () => {
  const stored = [
    { id: 'p1', name: 'Live synced', sku: 'KIL-1', lastSyncMode: 'live', lastSyncedAt: '2026-10-01T00:00:00.000Z' },
    { id: 'p2', name: 'Demo synced', sku: 'KIL-2', lastSyncMode: 'simulated', lastSyncedAt: '2026-10-01T00:00:00.000Z' },
    { id: 'p3', name: 'Bogus mode', sku: 'KIL-3', lastSyncMode: 'sideways' },
  ]
  withBrowserStorage({ [PRODUCTS_KEY]: JSON.stringify(stored) }, () => {
    const products = loadProducts()
    assert.equal(products.find((product) => product.id === 'p1').lastSyncMode, 'live')
    assert.equal(products.find((product) => product.id === 'p2').lastSyncMode, 'simulated')
    assert.equal(products.find((product) => product.id === 'p3').lastSyncMode, null)
  })
})

test('loadProducts repairs malformed attribute rows', () => {
  const stored = [
    {
      id: 'p1',
      name: 'Kept',
      sku: 'KIL-1',
      attributes: [
        { name: 'Finish', values: ['Matte', 7] },
        { name: '', values: [] },
        'junk',
        { name: 'Ports' },
      ],
    },
  ]
  withBrowserStorage({ [PRODUCTS_KEY]: JSON.stringify(stored) }, () => {
    const [product] = loadProducts()
    assert.deepEqual(
      product.attributes.map((attribute) => ({ name: attribute.name, values: attribute.values })),
      [
        { name: 'Finish', values: ['Matte', '7'] },
        { name: 'Ports', values: [] },
      ],
    )
    assert.ok(product.attributes.every((attribute) => attribute.id))
  })
})

test('loadProducts falls back to seeds when every stored record is unusable', () => {
  withBrowserStorage({ [PRODUCTS_KEY]: JSON.stringify([null, 'x']) }, () => {
    assert.equal(loadProducts().length, 6)
  })
})

test('saveProducts and loadProducts round-trip through localStorage', () => {
  withBrowserStorage({}, (fake) => {
    const payload = [{ id: 'p1', name: 'Stored', sku: 'KIL-9' }]
    saveProducts(payload)
    assert.ok(fake.map.has(PRODUCTS_KEY))
    assert.equal(loadProducts()[0].name, 'Stored')
  })
})

test('the sync log defaults to empty and round-trips', () => {
  withBrowserStorage({}, () => {
    assert.deepEqual(loadSyncLog(), [])
    saveSyncLog([{ id: 'log_1', outcome: 'success' }])
    assert.equal(loadSyncLog()[0].id, 'log_1')
  })
})

test('the sync log drops malformed entries and caps its length', () => {
  withBrowserStorage({}, () => {
    const entries = Array.from({ length: 80 }, (_, index) => ({ id: `log_${index}`, outcome: 'success' }))
    saveSyncLog(entries)
    assert.equal(loadSyncLog().length, 50)
  })
})

test('loadSyncLog normalizes stored order to newest first', () => {
  const stored = [
    { id: 'sim-old', at: '2026-10-15T09:00:00.000Z', outcome: 'success', mode: 'simulated' },
    { id: 'fail-newest', at: '2026-10-15T12:00:00.000Z', outcome: 'error', mode: 'live' },
    { id: 'no-timestamp', outcome: 'success', mode: 'live' },
    { id: 'live-new', at: '2026-10-15T11:00:00.000Z', outcome: 'success', mode: 'live' },
  ]
  withBrowserStorage({ [SYNC_LOG_KEY]: JSON.stringify(stored) }, () => {
    assert.deepEqual(
      loadSyncLog().map((entry) => entry.id),
      ['fail-newest', 'live-new', 'sim-old', 'no-timestamp'],
    )
  })
})

test('loadSyncLog tolerates corrupted and non-object entries', () => {
  withBrowserStorage({ ['kilowott-pim-sync/sync-log/v1']: '{not json' }, () => {
    assert.deepEqual(loadSyncLog(), [])
  })
  withBrowserStorage({ ['kilowott-pim-sync/sync-log/v1']: JSON.stringify([null, { id: 'a' }, 'x']) }, () => {
    assert.deepEqual(loadSyncLog(), [{ id: 'a' }])
  })
})

test('sync mode defaults to simulated and only accepts known modes', () => {
  withBrowserStorage({}, () => {
    assert.equal(loadSyncMode(), 'simulated')
    saveSyncMode('live')
    assert.equal(loadSyncMode(), 'live')
    saveSyncMode('sideways')
    assert.equal(loadSyncMode(), 'simulated')
  })
  withBrowserStorage({ [SYNC_MODE_KEY]: JSON.stringify('sideways') }, () => {
    assert.equal(loadSyncMode(), 'simulated')
  })
})

test('purgeLegacyConnectionSettings removes credentials stored by older versions', () => {
  withBrowserStorage(
    { [LEGACY_SETTINGS_KEY]: JSON.stringify({ storeUrl: 'https://shop.example.com', consumerKey: 'ck', consumerSecret: 'cs' }) },
    (fake) => {
      assert.ok(fake.map.has(LEGACY_SETTINGS_KEY))
      purgeLegacyConnectionSettings()
      assert.equal(fake.map.has(LEGACY_SETTINGS_KEY), false)
    },
  )
})
