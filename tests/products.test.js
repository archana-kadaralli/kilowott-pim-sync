import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COLOR_SWATCHES,
  createProduct,
  filterProducts,
  formatPrice,
  initialsFor,
  monogramTint,
  parseAttributeValues,
  productStats,
  removeProduct,
  seedProducts,
  swatchFor,
  updateProduct,
  validateAttributes,
  validateProduct,
} from '../src/lib/products.js'

const baseInput = {
  name: 'Aurora Desk Lamp',
  sku: 'KIL-1001',
  category: 'Lighting',
  price: '59',
  stock: '24',
  status: 'draft',
  description: 'Warm LED lamp',
  color: 'Pebble',
  size: 'Medium',
  material: 'Powder-coated steel',
  attributes: [],
}

test('validateProduct accepts a valid product', () => {
  assert.deepEqual(validateProduct(baseInput), {})
})

test('validateProduct requires name, sku, price, stock and category', () => {
  const errors = validateProduct({})
  assert.ok(errors.name)
  assert.ok(errors.sku)
  assert.ok(errors.price)
  assert.ok(errors.stock)
  assert.ok(errors.category)
})

test('validateProduct rejects negative price and non-integer stock', () => {
  const errors = validateProduct({ ...baseInput, price: '-1', stock: '2.5' })
  assert.match(errors.price, /negative/)
  assert.match(errors.stock, /whole number/)
})

test('validateProduct rejects non-numeric price and negative stock', () => {
  const errors = validateProduct({ ...baseInput, price: 'abc', stock: '-2' })
  assert.match(errors.price, /required/)
  assert.match(errors.stock, /negative/)
})

test('validateProduct enforces unique SKU across the catalog', () => {
  const existing = [{ id: 'p1', sku: 'KIL-1001' }]
  const errors = validateProduct({ ...baseInput, sku: 'kil-1001' }, { products: existing })
  assert.match(errors.sku, /unique/)

  const ownSku = validateProduct({ ...baseInput, sku: 'KIL-1001' }, { products: existing, productId: 'p1' })
  assert.equal(ownSku.sku, undefined)
})

test('validateAttributes flags unnamed, valueless and duplicate attributes', () => {
  assert.match(validateAttributes([{ name: '', values: ['Black'] }]), /needs a name/)
  assert.equal(validateAttributes([{ name: '', values: [] }]), null)
  assert.match(validateAttributes([{ name: 'Color', values: [] }]), /at least one value/)
  assert.match(
    validateAttributes([
      { name: 'Color', values: ['Black'] },
      { name: 'color', values: ['White'] },
    ]),
    /duplicated/,
  )
  assert.equal(validateAttributes([{ name: 'Color', values: ['Black'] }]), null)
})

test('createProduct normalizes input and starts as pending sync', () => {
  const product = createProduct({
    ...baseInput,
    name: '  Aurora Desk Lamp  ',
    color: '  Pebble ',
    size: ' Medium ',
    material: 'Powder-coated steel ',
    attributes: [{ name: ' Finish ', values: [' Matte '] }],
  })
  assert.equal(product.name, 'Aurora Desk Lamp')
  assert.equal(product.color, 'Pebble')
  assert.equal(product.size, 'Medium')
  assert.equal(product.material, 'Powder-coated steel')
  assert.equal(product.price, 59)
  assert.equal(product.stock, 24)
  assert.equal(product.syncStatus, 'pending')
  assert.equal(product.wooId, null)
  assert.equal(product.syncError, null)
  assert.deepEqual(product.attributes[0].values, ['Matte'])
  assert.ok(product.id.startsWith('prd_'))
})

test('updateProduct trims fields, resets sync state and keeps the woo id', () => {
  const product = createProduct(baseInput)
  const synced = { ...product, wooId: 100241, syncStatus: 'synced', lastSyncedAt: '2026-10-01T00:00:00.000Z' }
  const updated = updateProduct(synced, { ...baseInput, name: 'Aurora Lamp v2' })
  assert.equal(updated.name, 'Aurora Lamp v2')
  assert.equal(updated.syncStatus, 'pending')
  assert.equal(updated.wooId, 100241)
  assert.equal(updated.syncError, null)
})

test('removeProduct drops only the matching product', () => {
  const products = seedProducts()
  const remaining = removeProduct(products, 'prd_seed_mug')
  assert.equal(remaining.length, products.length - 1)
  assert.ok(remaining.every((product) => product.id !== 'prd_seed_mug'))
  assert.equal(removeProduct(products, 'missing-id').length, products.length)
})

test('parseAttributeValues splits, trims and drops empty values', () => {
  assert.deepEqual(parseAttributeValues('Black, White ,, Blue '), ['Black', 'White', 'Blue'])
})

test('swatchFor resolves known colour names and returns null otherwise', () => {
  assert.equal(swatchFor('Black'), COLOR_SWATCHES.black)
  assert.equal(swatchFor('Pale Indigo'), COLOR_SWATCHES.indigo)
  assert.equal(swatchFor(''), null)
  assert.equal(swatchFor('Fanta-time'), null)
})

test('monogram helpers are deterministic', () => {
  assert.equal(initialsFor('Aurora Desk Lamp'), 'AL')
  assert.equal(initialsFor('Mug'), 'MU')
  assert.equal(initialsFor(''), '—')
  assert.equal(monogramTint('Aurora Desk Lamp'), monogramTint('Aurora Desk Lamp'))
})

test('filterProducts searches name, sku, colour, material and attribute values', () => {
  const products = seedProducts()
  assert.equal(filterProducts(products, { query: 'aurora' }).length, 1)
  assert.equal(filterProducts(products, { query: 'KIL-4012' }).length, 1)
  assert.equal(filterProducts(products, { query: 'charcoal' }).length, 1)
  assert.equal(filterProducts(products, { query: 'recycled nylon' }).length, 1)
  assert.equal(filterProducts(products, { query: 'matte' }).length, 1)
  assert.equal(filterProducts(products, { query: 'cotton' }).length, 2)
  assert.equal(filterProducts(products, { query: 'not-a-product' }).length, 0)
})

test('filterProducts applies status, sync and category filters together', () => {
  const products = seedProducts()
  const draft = filterProducts(products, { status: 'draft' })
  assert.ok(draft.every((product) => product.status === 'draft'))
  const errors = filterProducts(products, { syncStatus: 'error' })
  assert.ok(errors.every((product) => product.syncStatus === 'error'))
  const lighting = filterProducts(products, { category: 'Lighting' })
  assert.ok(lighting.length >= 1)
  assert.ok(lighting.every((product) => product.category === 'Lighting'))
})

test('productStats summarizes the catalog', () => {
  const stats = productStats(seedProducts())
  assert.equal(stats.total, 6)
  assert.equal(stats.published, 4)
  assert.equal(stats.draft, 2)
  assert.equal(stats.synced, 3)
  assert.equal(stats.pending, 2)
  assert.equal(stats.error, 1)
  assert.equal(stats.lowStock, 2)
  assert.equal(stats.published + stats.draft, 6)
  assert.equal(stats.synced + stats.pending + stats.error, 6)
  assert.ok(stats.inventoryValue > 0)
})

test('the seed catalog contains the required Black T-Shirt entry', () => {
  const [first] = seedProducts()
  assert.equal(first.name, 'Black T-Shirt')
  assert.equal(first.sku, 'TSH-001')
  assert.equal(first.price, 499)
  assert.equal(first.stock, 20)
  assert.equal(first.color, 'Black')
  assert.equal(first.material, 'Cotton')
  assert.equal(first.category, 'Apparel')
  assert.equal(first.syncStatus, 'synced')
})

test('formatPrice formats Indian rupee values', () => {
  assert.equal(formatPrice(499), '₹499.00')
  assert.equal(formatPrice(123456), '₹1,23,456.00')
})

test('createProduct starts without a recorded sync mode', () => {
  const product = createProduct(baseInput)
  assert.equal(product.lastSyncMode, null)
})

test('the seed catalog records simulated demo modes for previously synced entries', () => {
  const seeds = seedProducts()
  const synced = seeds.filter((product) => product.lastSyncedAt)
  assert.ok(synced.length > 0)
  assert.ok(synced.every((product) => product.lastSyncMode === 'simulated'))
  assert.ok(seeds.filter((product) => !product.lastSyncedAt).every((product) => product.lastSyncMode === null))
})

test('updateProduct keeps the last sync mode as a historical record', () => {
  const product = {
    ...createProduct(baseInput),
    wooId: 100241,
    syncStatus: 'synced',
    lastSyncedAt: '2026-10-01T00:00:00.000Z',
    lastSyncMode: 'live',
  }
  const updated = updateProduct(product, { ...baseInput, name: 'Aurora Lamp v2' })
  assert.equal(updated.syncStatus, 'pending')
  assert.equal(updated.lastSyncMode, 'live')
})
