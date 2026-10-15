import { useEffect, useMemo, useState } from 'react'
import TopChrome from './components/TopChrome'
import ProductsView from './components/ProductsView'
import ProductForm from './components/ProductForm'
import SyncView from './components/SyncView'
import { ConfirmDialog } from './components/ui'
import { createProduct, makeId, removeProduct, updateProduct } from './lib/products'
import {
  loadProducts,
  loadSyncLog,
  loadSyncMode,
  purgeLegacyConnectionSettings,
  saveProducts,
  saveSyncLog,
  saveSyncMode,
} from './lib/storage'
import { applyTheme, prefersDark, readStoredTheme, resolveTheme, storeTheme, toggleTheme } from './lib/theme'
import {
  fetchLiveStatus,
  liveBlockReason,
  markSyncError,
  pushProductToLiveStore,
  pushProductToSimulatedStore,
} from './lib/woo'

export default function App() {
  const [theme, setTheme] = useState(() => resolveTheme(readStoredTheme(), prefersDark()))
  const [view, setView] = useState('catalog')
  const [products, setProducts] = useState(loadProducts)
  const [syncLog, setSyncLog] = useState(loadSyncLog)
  const [formState, setFormState] = useState(null)
  const [confirmProduct, setConfirmProduct] = useState(null)
  const [syncingIds, setSyncingIds] = useState([])
  const [forceFail, setForceFail] = useState(false)
  const [syncMode, setSyncMode] = useState(loadSyncMode)
  const [liveStatus, setLiveStatus] = useState(null)
  const [liveChecking, setLiveChecking] = useState(true)
  const [liveCheckedAt, setLiveCheckedAt] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    saveProducts(products)
  }, [products])

  useEffect(() => {
    saveSyncLog(syncLog)
  }, [syncLog])

  useEffect(() => {
    saveSyncMode(syncMode)
  }, [syncMode])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    purgeLegacyConnectionSettings()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (!readStoredTheme()) setTheme(resolveTheme(null, media.matches))
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchLiveStatus().then((status) => {
      if (cancelled) return
      setLiveStatus(status)
      setLiveChecking(false)
      setLiveCheckedAt(new Date().toISOString())
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(timer)
  }, [toast])

  const pendingCount = useMemo(
    () => products.filter((product) => product.syncStatus !== 'synced').length,
    [products],
  )

  function notify(tone, message) {
    setToast({ tone, message, at: Date.now() })
  }

  function handleToggleTheme() {
    const next = toggleTheme(theme)
    setTheme(next)
    storeTheme(next)
  }

  async function refreshLiveStatus() {
    setLiveChecking(true)
    const status = await fetchLiveStatus()
    setLiveStatus(status)
    setLiveChecking(false)
    setLiveCheckedAt(new Date().toISOString())
    return status
  }

  function handleSyncModeChange(mode) {
    setSyncMode(mode)
    if (mode === 'live') refreshLiveStatus()
  }

  function addLog(entry) {
    setSyncLog((log) => [{ id: makeId('log'), at: new Date().toISOString(), ...entry }, ...log].slice(0, 50))
  }

  function handleSave(input) {
    const editing = formState?.product ?? null
    if (editing) {
      setProducts((list) => list.map((product) => (product.id === editing.id ? updateProduct(product, input) : product)))
      notify('success', `"${input.name}" saved — queued for the next sync run.`)
    } else {
      setProducts((list) => [createProduct(input), ...list])
      notify('success', `"${input.name}" added to the catalog — queued for sync.`)
    }
    setFormState(null)
  }

  function handleDelete(product) {
    setConfirmProduct(product)
  }

  function confirmDelete() {
    if (!confirmProduct) return
    setProducts((list) => removeProduct(list, confirmProduct.id))
    notify('success', `"${confirmProduct.name}" deleted from the catalog.`)
    setConfirmProduct(null)
  }

  async function syncOne(product, { silent = false } = {}) {
    if (syncMode === 'live') {
      const blocked = liveBlockReason(liveStatus, liveChecking)
      if (blocked) {
        if (!silent) notify('error', blocked)
        if (!liveChecking) refreshLiveStatus()
        return false
      }
    }

    setSyncingIds((ids) => [...ids, product.id])
    try {
      const synced =
        syncMode === 'live'
          ? await pushProductToLiveStore(product)
          : await pushProductToSimulatedStore(product, { delay: 600, fail: forceFail })

      setProducts((list) => list.map((item) => (item.id === product.id ? synced : item)))
      addLog({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        outcome: 'success',
        mode: syncMode,
        message:
          syncMode === 'live'
            ? `Store accepted the request · WooCommerce ID #${synced.wooId}`
            : `Pushed to simulated WooCommerce · demo ID #${synced.wooId}`,
      })
      if (!silent) notify('success', `"${product.name}" synced.`)
      return true
    } catch (error) {
      const failed = markSyncError(product, error.message)
      setProducts((list) => list.map((item) => (item.id === product.id ? failed : item)))
      addLog({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        outcome: 'error',
        mode: syncMode,
        message: error.message,
      })
      if (syncMode === 'live' && typeof error.code === 'string' && error.code.startsWith('proxy_')) {
        refreshLiveStatus()
      }
      if (!silent) notify('error', `"${product.name}" failed to sync — ${error.message}`)
      return false
    } finally {
      setSyncingIds((ids) => ids.filter((id) => id !== product.id))
    }
  }

  async function syncMany(list) {
    let synced = 0
    let failed = 0
    for (const product of list) {
      const ok = await syncOne(product, { silent: true })
      if (ok) synced += 1
      else failed += 1
    }
    if (failed === 0) notify('success', `Sync run finished — ${synced} product${synced === 1 ? '' : 's'} synced.`)
    else notify('error', `Sync run finished — ${synced} synced, ${failed} failed. Check the activity ledger.`)
  }

  return (
    <div className="app">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>

      <TopChrome
        view={view}
        onNavigate={setView}
        productCount={products.length}
        pendingCount={pendingCount}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      <main className="shell" id="workspace">
        {view === 'catalog' ? (
          <ProductsView
            products={products}
            syncLog={syncLog}
            syncingIds={syncingIds}
            onAdd={() => setFormState({ product: null })}
            onEdit={(product) => setFormState({ product })}
            onDelete={handleDelete}
            onSync={syncOne}
            onOpenSync={() => setView('sync')}
          />
        ) : null}
        {view === 'sync' ? (
          <SyncView
            products={products}
            syncLog={syncLog}
            syncingIds={syncingIds}
            forceFail={forceFail}
            onForceFailChange={setForceFail}
            onSyncOne={syncOne}
            onSyncMany={syncMany}
            syncMode={syncMode}
            onSyncModeChange={handleSyncModeChange}
            liveStatus={liveStatus}
            liveChecking={liveChecking}
            liveCheckedAt={liveCheckedAt}
            onRefreshLiveStatus={refreshLiveStatus}
          />
        ) : null}
      </main>

      {formState ? (
        <ProductForm
          key={formState.product?.id ?? 'new'}
          product={formState.product}
          products={products}
          onSave={handleSave}
          onCancel={() => setFormState(null)}
          syncMode={syncMode}
        />
      ) : null}

      {confirmProduct ? (
        <ConfirmDialog
          title={`Delete “${confirmProduct.name}”?`}
          message={`SKU ${confirmProduct.sku} will be removed from the local catalog. This cannot be undone, and the store is not touched.`}
          confirmLabel="Delete product"
          onConfirm={confirmDelete}
          onCancel={() => setConfirmProduct(null)}
        />
      ) : null}

      {toast ? (
        <div className={`toast toast-${toast.tone}`} role="status" aria-live="polite">
          {toast.message}
        </div>
      ) : null}
    </div>
  )
}
