import { useMemo, useState } from 'react'
import { EmptyState, Icon, ProductStatusBadge, Spinner, Swatch, SyncStatusBadge } from './ui'
import { filterProducts, formatPrice, listCategories, LOW_STOCK_THRESHOLD, productStats } from '../lib/products'
import { latestSuccessfulRun } from '../lib/woo'

function formatSyncTime(value) {
  if (!value) return null
  return new Date(value).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function AttributeChip({ label, value }) {
  return (
    <span className="chip" title={`${label}: ${value}`}>
      <span className="chip-label">{label}</span>
      {value}
    </span>
  )
}

function attributeChipsFor(product) {
  return [
    product.color ? <AttributeChip key="color" label="Colour" value={product.color} /> : null,
    product.size ? <AttributeChip key="size" label="Size" value={product.size} /> : null,
    product.material ? <AttributeChip key="material" label="Material" value={product.material} /> : null,
    ...(product.attributes ?? []).map((attribute) => (
      <AttributeChip key={attribute.id} label={attribute.name} value={attribute.values.join(', ')} />
    )),
  ].filter(Boolean)
}

function SyncMeta({ product }) {
  return (
    <>
      <span className="sync-time mono">
        {product.lastSyncedAt ? (
          <>
            {formatSyncTime(product.lastSyncedAt)}
            {product.lastSyncMode ? (
              <span className={`sync-mode sync-mode-${product.lastSyncMode}`}>
                {product.lastSyncMode === 'live' ? 'live' : 'demo'}
              </span>
            ) : null}
          </>
        ) : (
          'Never synced'
        )}
      </span>
      {product.syncStatus === 'error' && product.syncError ? <p className="sync-error">{product.syncError}</p> : null}
    </>
  )
}

function RowActions({ product, isSyncing, onSync, onEdit, onDelete }) {
  return (
    <div className="row-actions">
      <button
        type="button"
        className="action-btn action-sync"
        onClick={() => onSync(product)}
        disabled={isSyncing}
        title={`Sync “${product.name}” now`}
      >
        {isSyncing ? <Spinner /> : <Icon name="sync" size={14} />}
        {isSyncing ? 'Syncing' : 'Sync'}
      </button>
      <button
        type="button"
        className="action-btn action-edit"
        onClick={() => onEdit(product)}
        title={`Edit “${product.name}”`}
      >
        <Icon name="pencil" size={14} />
        Edit
      </button>
      <button
        type="button"
        className="action-btn action-delete"
        onClick={() => onDelete(product)}
        title={`Delete “${product.name}”`}
      >
        <Icon name="trash" size={14} />
        Delete
      </button>
    </div>
  )
}

export default function ProductsView({ products, syncLog, syncingIds, onAdd, onEdit, onDelete, onSync, onOpenSync }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [syncStatus, setSyncStatus] = useState('all')

  const categories = useMemo(() => listCategories(products), [products])
  const stats = useMemo(() => productStats(products), [products])
  const visible = useMemo(
    () => filterProducts(products, { query, syncStatus, category }).sort((a, b) => a.name.localeCompare(b.name)),
    [products, query, syncStatus, category],
  )

  const hasFilters = query.trim() !== '' || category !== 'all' || syncStatus !== 'all'
  const lastSuccess = latestSuccessfulRun(syncLog)
  const openCount = stats.pending + stats.error

  function clearFilters() {
    setQuery('')
    setCategory('all')
    setSyncStatus('all')
  }

  return (
    <div className="view">
      <section className="mast">
        <div className="mast-main">
          <p className="eyebrow">PIM Sync · Product operations</p>
          <h1 className="mast-title">
            Product
            <br />
            Catalog
          </h1>
          <p className="lede">
            One workspace for names, SKUs, prices, stock and attributes. Products are saved in this browser and queued
            for the WooCommerce sync run.
          </p>
          <div className="mast-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={onAdd}>
              <Icon name="plus" size={15} />
              Add Product
            </button>
            <button type="button" className="text-link" onClick={onOpenSync}>
              Open sync workspace
            </button>
          </div>
        </div>

        <aside className="mast-side" aria-label="Catalog summary">
          <p className="micro-label">Entries on file</p>
          <p className="mast-index">{String(stats.total).padStart(2, '0')}</p>
          <dl className="mast-stats">
            <div className="mast-stat">
              <dt>Published</dt>
              <dd>{stats.published}</dd>
            </div>
            <div className="mast-stat">
              <dt>Synced</dt>
              <dd>{stats.synced}</dd>
            </div>
            <div className="mast-stat">
              <dt>Needs sync</dt>
              <dd className={openCount > 0 ? 'stat-alert' : undefined}>{openCount}</dd>
            </div>
            <div className="mast-stat">
              <dt>Low stock</dt>
              <dd>{stats.lowStock}</dd>
            </div>
            <div className="mast-stat mast-stat-wide">
              <dt>Last sync</dt>
              <dd>
                {lastSuccess
                  ? `${lastSuccess.mode === 'live' ? 'Live store' : 'Simulated demo'} · ${formatSyncTime(lastSuccess.at)}`
                  : 'No runs yet'}
              </dd>
            </div>
          </dl>
        </aside>
      </section>

      <div className="toolbar" role="search">
        <label className="search">
          <span className="visually-hidden">Search products</span>
          <Icon name="search" size={14} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, SKU, colour, size, material or attribute…"
          />
        </label>

        <label className="select">
          <span className="visually-hidden">Filter by category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="select">
          <span className="visually-hidden">Filter by synchronization status</span>
          <select value={syncStatus} onChange={(event) => setSyncStatus(event.target.value)}>
            <option value="all">All sync statuses</option>
            <option value="synced">Synced</option>
            <option value="pending">Needs sync</option>
            <option value="error">Sync failed</option>
          </select>
        </label>

        {hasFilters ? (
          <button type="button" className="text-link" onClick={clearFilters}>
            Clear filters
          </button>
        ) : null}

        <span className="result-note" aria-live="polite">
          {hasFilters ? `Showing ${visible.length} of ${products.length}` : `${products.length} products`}
        </span>
      </div>

      {products.length === 0 ? (
        <EmptyState
          glyph="00"
          title="No products yet"
          message="Use “Add Product” to create your first entry — it is stored in this browser and queued for sync."
        />
      ) : visible.length === 0 ? (
        <EmptyState glyph="00" title="Nothing matches" message="Try a different search term or clear the filters." />
      ) : (
        <>
          <div className="manifest-wrap">
            <table className="manifest">
              <thead>
                <tr>
                  <th scope="col" className="idx-col hide-narrow">
                    <span className="visually-hidden">Row</span>
                  </th>
                  <th scope="col">Product</th>
                  <th scope="col" className="hide-narrow">Attributes</th>
                  <th scope="col" className="hide-narrow">Category</th>
                  <th scope="col" className="num">Price</th>
                  <th scope="col" className="num">Stock</th>
                  <th scope="col">Store &amp; sync</th>
                  <th scope="col" className="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((product, index) => {
                  const isSyncing = syncingIds.includes(product.id)
                  const attributeChips = attributeChipsFor(product)

                  return (
                    <tr key={product.id} className={isSyncing ? 'row-busy' : undefined}>
                      <td className="idx-col mono hide-narrow">{String(index + 1).padStart(2, '0')}</td>
                      <td>
                        <div className="product-cell">
                          <Swatch color={product.color} name={product.name} />
                          <div className="product-cell-text">
                            <p className="p-name">{product.name}</p>
                            <p className="p-sku mono">{product.sku}</p>
                          </div>
                        </div>
                      </td>
                      <td className="hide-narrow">
                        {attributeChips.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          <div className="chips">{attributeChips}</div>
                        )}
                      </td>
                      <td className="hide-narrow">{product.category}</td>
                      <td className="num mono">{formatPrice(product.price)}</td>
                      <td className="num">
                        <span className="mono">{product.stock}</span>
                        {product.stock <= LOW_STOCK_THRESHOLD ? <span className="stock-low">low</span> : null}
                      </td>
                      <td>
                        <div className="sync-cell">
                          <div className="state-badges">
                            <ProductStatusBadge status={product.status} />
                            <SyncStatusBadge status={product.syncStatus} />
                          </div>
                          <SyncMeta product={product} />
                        </div>
                      </td>
                      <td className="actions-col">
                        <RowActions
                          product={product}
                          isSyncing={isSyncing}
                          onSync={onSync}
                          onEdit={onEdit}
                          onDelete={onDelete}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <ul className="product-cards" aria-label="Product list">
            {visible.map((product) => {
              const isSyncing = syncingIds.includes(product.id)
              const attributeChips = attributeChipsFor(product)

              return (
                <li key={product.id} className={`product-card${isSyncing ? ' row-busy' : ''}`}>
                  <div className="card-head">
                    <Swatch color={product.color} name={product.name} />
                    <div className="card-title">
                      <p className="p-name">{product.name}</p>
                      <p className="p-sku mono">{product.sku}</p>
                    </div>
                    <ProductStatusBadge status={product.status} />
                  </div>

                  <dl className="card-facts">
                    <div className="card-fact">
                      <dt>Category</dt>
                      <dd>{product.category}</dd>
                    </div>
                    <div className="card-fact">
                      <dt>Price</dt>
                      <dd className="mono">{formatPrice(product.price)}</dd>
                    </div>
                    <div className="card-fact">
                      <dt>Stock</dt>
                      <dd>
                        <span className="mono">{product.stock}</span>
                        {product.stock <= LOW_STOCK_THRESHOLD ? <span className="stock-low">low</span> : null}
                      </dd>
                    </div>
                  </dl>

                  {attributeChips.length > 0 ? <div className="chips card-chips">{attributeChips}</div> : null}

                  <div className="sync-cell card-sync">
                    <div className="state-badges">
                      <SyncStatusBadge status={product.syncStatus} />
                    </div>
                    <SyncMeta product={product} />
                  </div>

                  <RowActions
                    product={product}
                    isSyncing={isSyncing}
                    onSync={onSync}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                </li>
              )
            })}
          </ul>
        </>
      )}

      <p className="footnote">
        Sync is queued per product or in bulk from the{' '}
        <button type="button" className="text-link" onClick={onOpenSync}>
          sync workspace
        </button>
        . Demo runs make no network requests — nothing is sent to a store. Live runs go through the local proxy only
        when the server reports a valid configuration.
      </p>
    </div>
  )
}
