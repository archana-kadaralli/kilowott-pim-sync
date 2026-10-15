export const CATEGORIES = [
  'Accessories',
  'Apparel',
  'Electronics',
  'Home & Living',
  'Lighting',
  'Uncategorized',
]

export const LOW_STOCK_THRESHOLD = 5

let idCounter = 0

export function makeId(prefix) {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`
}

export function createAttribute(name = '', values = []) {
  return { id: makeId('attr'), name, values }
}

export function parseAttributeValues(text) {
  return String(text ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

export function normalizeAttributes(attributes = []) {
  return attributes
    .map((attribute) => ({
      id: attribute.id ?? makeId('attr'),
      name: String(attribute.name ?? '').trim(),
      values: (attribute.values ?? []).map((value) => String(value).trim()).filter(Boolean),
    }))
    .filter((attribute) => attribute.name || attribute.values.length > 0)
}

export function normalizeProduct(input = {}) {
  return {
    name: String(input.name ?? '').trim(),
    sku: String(input.sku ?? '').trim(),
    category: String(input.category ?? '').trim() || 'Uncategorized',
    description: String(input.description ?? '').trim(),
    price: Number(input.price),
    stock: Number(input.stock),
    status: input.status === 'published' ? 'published' : 'draft',
    color: String(input.color ?? '').trim(),
    size: String(input.size ?? '').trim(),
    material: String(input.material ?? '').trim(),
    attributes: normalizeAttributes(input.attributes),
  }
}

export function createProduct(input = {}) {
  const now = new Date().toISOString()
  return {
    id: makeId('prd'),
    ...normalizeProduct(input),
    wooId: null,
    syncStatus: 'pending',
    syncError: null,
    lastSyncedAt: null,
    lastSyncMode: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function updateProduct(product, input = {}) {
  return {
    ...product,
    ...normalizeProduct(input),
    syncStatus: 'pending',
    syncError: null,
    updatedAt: new Date().toISOString(),
  }
}

export function removeProduct(products = [], id) {
  return products.filter((product) => product.id !== id)
}

export function validateAttributes(attributes = []) {
  const seen = new Set()
  for (const [index, attribute] of attributes.entries()) {
    const name = String(attribute.name ?? '').trim()
    const values = (attribute.values ?? []).map((value) => String(value).trim()).filter(Boolean)
    if (!name && values.length === 0) continue
    if (!name) return `Attribute ${index + 1} needs a name.`
    if (values.length === 0) return `Attribute "${name}" needs at least one value.`
    const key = name.toLowerCase()
    if (seen.has(key)) return `Attribute "${name}" is duplicated.`
    seen.add(key)
  }
  return null
}

export function validateProduct(input = {}, { products = [], productId = null } = {}) {
  const errors = {}

  const name = String(input.name ?? '').trim()
  if (!name) errors.name = 'Name is required.'
  else if (name.length < 2) errors.name = 'Name must be at least 2 characters.'

  const sku = String(input.sku ?? '').trim()
  if (!sku) errors.sku = 'SKU is required.'
  else if (products.some((product) => product.id !== productId && product.sku.trim().toLowerCase() === sku.toLowerCase())) {
    errors.sku = 'SKU must be unique across the catalog.'
  }

  const rawPrice = input.price
  const price = Number(rawPrice)
  if (rawPrice === '' || rawPrice === null || rawPrice === undefined || Number.isNaN(price)) {
    errors.price = 'Price is required.'
  } else if (price < 0) {
    errors.price = 'Price cannot be negative.'
  }

  const rawStock = input.stock
  const stock = Number(rawStock)
  if (rawStock === '' || rawStock === null || rawStock === undefined || Number.isNaN(stock)) {
    errors.stock = 'Stock is required.'
  } else if (!Number.isInteger(stock)) {
    errors.stock = 'Stock must be a whole number.'
  } else if (stock < 0) {
    errors.stock = 'Stock cannot be negative.'
  }

  if (!String(input.category ?? '').trim()) errors.category = 'Category is required.'

  const attributeError = validateAttributes(Array.isArray(input.attributes) ? input.attributes : [])
  if (attributeError) errors.attributes = attributeError

  return errors
}

export function filterProducts(products = [], { query = '', status = 'all', syncStatus = 'all', category = 'all' } = {}) {
  const needle = query.trim().toLowerCase()
  return products.filter((product) => {
    if (status !== 'all' && product.status !== status) return false
    if (syncStatus !== 'all' && product.syncStatus !== syncStatus) return false
    if (category !== 'all' && product.category !== category) return false
    if (!needle) return true
    const haystack = [
      product.name,
      product.sku,
      product.category,
      product.color,
      product.size,
      product.material,
      product.description,
      ...(product.attributes ?? []).flatMap((attribute) => [attribute.name, ...attribute.values]),
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  })
}

export function listCategories(products = []) {
  const categories = new Set(CATEGORIES)
  for (const product of products) {
    if (product.category) categories.add(product.category)
  }
  return [...categories].sort((a, b) => a.localeCompare(b))
}

export function productStats(products = []) {
  const stats = {
    total: products.length,
    published: 0,
    draft: 0,
    synced: 0,
    pending: 0,
    error: 0,
    lowStock: 0,
    inventoryValue: 0,
  }
  for (const product of products) {
    if (product.status === 'published') stats.published += 1
    else stats.draft += 1
    if (product.syncStatus === 'synced') stats.synced += 1
    else if (product.syncStatus === 'pending') stats.pending += 1
    else if (product.syncStatus === 'error') stats.error += 1
    if (product.stock <= LOW_STOCK_THRESHOLD) stats.lowStock += 1
    stats.inventoryValue += product.price * product.stock
  }
  return stats
}

export function formatPrice(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value) || 0)
}

export const COLOR_SWATCHES = {
  black: '#211f1a',
  charcoal: '#3a3733',
  graphite: '#46443f',
  slate: '#5e6b70',
  grey: '#8b8b86',
  gray: '#8b8b86',
  silver: '#b9b8b2',
  white: '#fbf9f4',
  cream: '#e9dfc9',
  ivory: '#f0e8d8',
  sand: '#d9c7a7',
  beige: '#ded3bb',
  pebble: '#c9c2b4',
  straw: '#d6c186',
  ochre: '#c48a2f',
  yellow: '#d9b23c',
  orange: '#d07a2e',
  terracotta: '#b3654a',
  rust: '#b05a33',
  cognac: '#8a5a2b',
  tan: '#c19a6b',
  brown: '#6f5136',
  plum: '#5c4453',
  rose: '#c98a8f',
  red: '#b5432c',
  vermilion: '#d84a1b',
  green: '#5a7156',
  olive: '#6b6a45',
  sage: '#a3ab8f',
  blue: '#4a6b8a',
  indigo: '#37415e',
  navy: '#2b3550',
}

export function swatchFor(color) {
  const key = String(color ?? '').trim().toLowerCase()
  if (!key) return null
  if (COLOR_SWATCHES[key]) return COLOR_SWATCHES[key]
  for (const [name, hex] of Object.entries(COLOR_SWATCHES)) {
    if (key.includes(name)) return hex
  }
  return null
}

export const MONOGRAM_TINTS = ['#dbe1f4', '#d8e6ea', '#e0dcf1', '#d9e6dc', '#e5dded', '#d5e0f0']

export function monogramTint(seed = '') {
  let hash = 0
  for (const character of String(seed)) {
    hash = (hash * 31 + character.charCodeAt(0)) % 100000
  }
  return MONOGRAM_TINTS[hash % MONOGRAM_TINTS.length]
}

export function initialsFor(name = '') {
  const words = String(name).trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '—'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

export function seedProducts() {
  return structuredClone([
    {
      id: 'prd_seed_tshirt',
      name: 'Black T-Shirt',
      sku: 'TSH-001',
      category: 'Apparel',
      description: 'Everyday crew-neck t-shirt in soft combed cotton.',
      price: 499,
      stock: 20,
      status: 'published',
      color: 'Black',
      size: 'S–XL',
      material: 'Cotton',
      attributes: [],
      wooId: 100243,
      syncStatus: 'synced',
      syncError: null,
      lastSyncedAt: '2026-10-01T09:17:00.000Z',
      createdAt: '2026-09-15T08:00:00.000Z',
      updatedAt: '2026-10-01T09:17:00.000Z',
    },
    {
      id: 'prd_seed_lamp',
      name: 'Aurora Desk Lamp',
      sku: 'KIL-1001',
      category: 'Lighting',
      description: 'Warm LED desk lamp with an adjustable arm and touch dimmer.',
      price: 1299,
      stock: 24,
      status: 'published',
      color: 'Pebble',
      size: 'Medium',
      material: 'Powder-coated steel',
      attributes: [{ id: 'attr_seed_lamp_power', name: 'Power', values: ['5W', '9W'] }],
      wooId: 100241,
      syncStatus: 'synced',
      syncError: null,
      lastSyncedAt: '2026-10-01T09:15:00.000Z',
      createdAt: '2026-09-18T08:00:00.000Z',
      updatedAt: '2026-10-01T09:15:00.000Z',
    },
    {
      id: 'prd_seed_mug',
      name: 'Kilowott Ceramic Mug',
      sku: 'KIL-2004',
      category: 'Home & Living',
      description: 'Stoneware mug with a matte glaze.',
      price: 349,
      stock: 3,
      status: 'published',
      color: 'Slate',
      size: '350 ml',
      material: 'Glazed stoneware',
      attributes: [{ id: 'attr_seed_mug_finish', name: 'Finish', values: ['Matte', 'Gloss'] }],
      wooId: 100242,
      syncStatus: 'synced',
      syncError: null,
      lastSyncedAt: '2026-10-01T09:16:00.000Z',
      createdAt: '2026-09-20T10:30:00.000Z',
      updatedAt: '2026-10-01T09:16:00.000Z',
    },
    {
      id: 'prd_seed_hoodie',
      name: 'Kilowott Logo Hoodie',
      sku: 'KIL-3007',
      category: 'Apparel',
      description: 'Heavyweight cotton hoodie with embroidered logo.',
      price: 1699,
      stock: 40,
      status: 'draft',
      color: 'Charcoal',
      size: 'S–XL',
      material: 'Heavyweight cotton',
      attributes: [{ id: 'attr_seed_hoodie_fit', name: 'Fit', values: ['Relaxed', 'Regular'] }],
      wooId: null,
      syncStatus: 'pending',
      syncError: null,
      lastSyncedAt: null,
      createdAt: '2026-10-08T14:45:00.000Z',
      updatedAt: '2026-10-08T14:45:00.000Z',
    },
    {
      id: 'prd_seed_hub',
      name: 'USB-C Travel Hub',
      sku: 'KIL-4012',
      category: 'Electronics',
      description: '7-in-1 hub with HDMI, USB-A, SD and 100W pass-through charging.',
      price: 2499,
      stock: 12,
      status: 'published',
      color: 'Graphite',
      size: '7-in-1',
      material: 'Aluminium',
      attributes: [{ id: 'attr_seed_hub_ports', name: 'Ports', values: ['HDMI', 'USB-A', 'SD'] }],
      wooId: null,
      syncStatus: 'error',
      syncError: 'Simulated WooCommerce request failed (forced failure).',
      lastSyncedAt: null,
      createdAt: '2026-09-28T11:05:00.000Z',
      updatedAt: '2026-10-10T16:20:00.000Z',
    },
    {
      id: 'prd_seed_strap',
      name: 'Woven Laptop Strap',
      sku: 'KIL-5015',
      category: 'Accessories',
      description: 'Adjustable woven strap that fits most 13–16 inch laptops.',
      price: 899,
      stock: 0,
      status: 'draft',
      color: 'Indigo',
      size: '13–16 in',
      material: 'Recycled nylon',
      attributes: [],
      wooId: null,
      syncStatus: 'pending',
      syncError: null,
      lastSyncedAt: null,
      createdAt: '2026-10-12T09:40:00.000Z',
      updatedAt: '2026-10-12T09:40:00.000Z',
    },
  ]).map((product) => ({
    lastSyncMode: product.lastSyncedAt ? 'simulated' : null,
    ...product,
  }))
}
