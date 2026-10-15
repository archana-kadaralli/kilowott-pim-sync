import { makeId, seedProducts } from './products.js'
import { isSyncMode } from './woo.js'

const PRODUCTS_KEY = 'kilowott-pim-sync/products/v1'
const SYNC_LOG_KEY = 'kilowott-pim-sync/sync-log/v1'
const SYNC_MODE_KEY = 'kilowott-pim-sync/sync-mode/v1'
const LEGACY_SETTINGS_KEY = 'kilowott-pim-sync/connection/v1'

const SYNC_STATUSES = new Set(['pending', 'synced', 'error'])
const MAX_LOG_ENTRIES = 50

function read(key, fallback) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    return
  }
}

function asString(value, fallback = '') {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function asCount(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, number)
}

function hydrateAttribute(input) {
  if (!input || typeof input !== 'object') return null
  const name = asString(input.name).trim()
  const values = Array.isArray(input.values)
    ? input.values.map((value) => asString(value).trim()).filter(Boolean)
    : []
  if (!name && values.length === 0) return null
  return { id: asString(input.id).trim() || makeId('attr'), name, values }
}

export function hydrateProduct(input) {
  if (!input || typeof input !== 'object') return null
  const now = new Date().toISOString()
  return {
    id: asString(input.id).trim() || makeId('prd'),
    name: asString(input.name).trim(),
    sku: asString(input.sku).trim(),
    category: asString(input.category).trim() || 'Uncategorized',
    description: asString(input.description),
    price: asCount(input.price),
    stock: Math.floor(asCount(input.stock)),
    status: input.status === 'published' ? 'published' : 'draft',
    color: asString(input.color).trim(),
    size: asString(input.size).trim(),
    material: asString(input.material).trim(),
    attributes: (Array.isArray(input.attributes) ? input.attributes : []).map(hydrateAttribute).filter(Boolean),
    wooId: Number.isInteger(input.wooId) ? input.wooId : null,
    syncStatus: SYNC_STATUSES.has(input.syncStatus) ? input.syncStatus : 'pending',
    syncError: typeof input.syncError === 'string' && input.syncError ? input.syncError : null,
    lastSyncedAt: typeof input.lastSyncedAt === 'string' ? input.lastSyncedAt : null,
    lastSyncMode:
      input.lastSyncMode === 'live' || input.lastSyncMode === 'simulated' ? input.lastSyncMode : null,
    createdAt: asString(input.createdAt, now),
    updatedAt: asString(input.updatedAt, now),
  }
}

export function loadProducts() {
  const products = read(PRODUCTS_KEY, null)
  if (!Array.isArray(products)) return seedProducts()
  const hydrated = products.map(hydrateProduct).filter(Boolean)
  return hydrated.length > 0 ? hydrated : seedProducts()
}

export function saveProducts(products) {
  write(PRODUCTS_KEY, products)
}

export function loadSyncLog() {
  const log = read(SYNC_LOG_KEY, null)
  if (!Array.isArray(log)) return []
  const entries = log.filter((entry) => entry && typeof entry === 'object')
  entries.sort((a, b) => {
    const aAt = Date.parse(a.at ?? '')
    const bAt = Date.parse(b.at ?? '')
    const aValid = Number.isFinite(aAt)
    const bValid = Number.isFinite(bAt)
    if (aValid && bValid) return bAt - aAt
    if (aValid) return -1
    if (bValid) return 1
    return 0
  })
  return entries.slice(0, MAX_LOG_ENTRIES)
}

export function saveSyncLog(log) {
  write(SYNC_LOG_KEY, Array.isArray(log) ? log.slice(0, MAX_LOG_ENTRIES) : [])
}

export function loadSyncMode() {
  const mode = read(SYNC_MODE_KEY, 'simulated')
  return isSyncMode(mode) ? mode : 'simulated'
}

export function saveSyncMode(mode) {
  write(SYNC_MODE_KEY, isSyncMode(mode) ? mode : 'simulated')
}

export function purgeLegacyConnectionSettings() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.removeItem(LEGACY_SETTINGS_KEY)
  } catch {
    return
  }
}
