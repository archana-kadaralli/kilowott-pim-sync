import { useState } from 'react'
import { Badge, Drawer, SimulatedBadge, Swatch } from './ui'
import {
  CATEGORIES,
  createAttribute,
  normalizeProduct,
  parseAttributeValues,
  validateProduct,
} from '../lib/products'

const FIELD_IDS = {
  name: 'product-name',
  sku: 'product-sku',
  category: 'product-category',
  price: 'product-price',
  stock: 'product-stock',
}

const FIELD_ORDER = ['name', 'sku', 'category', 'price', 'stock', 'attributes']

function buildInitialDraft(product) {
  if (!product) {
    return {
      name: '',
      sku: '',
      category: 'Uncategorized',
      price: '',
      stock: '',
      status: 'draft',
      color: '',
      size: '',
      material: '',
      description: '',
      attributes: [createAttribute()],
    }
  }
  return {
    name: product.name,
    sku: product.sku,
    category: product.category,
    price: String(product.price),
    stock: String(product.stock),
    status: product.status,
    color: product.color ?? '',
    size: product.size ?? '',
    material: product.material ?? '',
    description: product.description ?? '',
    attributes: (product.attributes ?? []).map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      valuesText: attribute.values.join(', '),
    })),
  }
}

export default function ProductForm({ product, products, onSave, onCancel, syncMode }) {
  const [draft, setDraft] = useState(() => buildInitialDraft(product))
  const [errors, setErrors] = useState({})

  function setField(key, value) {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  function setAttribute(index, patch) {
    setDraft((current) => ({
      ...current,
      attributes: current.attributes.map((attribute, position) =>
        position === index ? { ...attribute, ...patch } : attribute,
      ),
    }))
    setErrors((current) => {
      if (!current.attributes) return current
      const next = { ...current }
      delete next.attributes
      return next
    })
  }

  function addAttribute() {
    setDraft((current) => ({ ...current, attributes: [...current.attributes, createAttribute()] }))
  }

  function removeAttribute(index) {
    setDraft((current) => ({
      ...current,
      attributes: current.attributes.filter((_, position) => position !== index),
    }))
  }

  function handleSubmit(event) {
    event.preventDefault()
    const input = {
      ...draft,
      attributes: draft.attributes.map((attribute) => ({
        id: attribute.id,
        name: attribute.name,
        values: parseAttributeValues(attribute.valuesText),
      })),
    }
    const nextErrors = validateProduct(input, { products, productId: product?.id ?? null })
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      const firstKey = FIELD_ORDER.find((key) => nextErrors[key])
      const focusId = firstKey === 'attributes' ? 'attribute-name-0' : FIELD_IDS[firstKey]
      if (focusId) document.getElementById(focusId)?.focus()
      return
    }
    onSave(normalizeProduct(input))
  }

  return (
    <Drawer
      eyebrow={`Catalog — ${product ? 'Edit entry' : 'New entry'}`}
      title={product ? product.name : 'New product'}
      subtitle="Saved to this browser via localStorage, then marked pending until the next sync run."
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" form="product-form" className="btn btn-primary">
            {product ? 'Save changes' : 'Create product'}
          </button>
        </>
      }
    >
      <form id="product-form" className="form" onSubmit={handleSubmit} noValidate>
        <section className="form-section">
          <p className="eyebrow">01 — Identity</p>
          <div className="form-grid">
            <div className="field field-span-2">
              <label htmlFor="product-name">Name</label>
              <input
                id="product-name"
                className="field-input"
                value={draft.name}
                onChange={(event) => setField('name', event.target.value)}
                placeholder="Aurora Desk Lamp"
                autoFocus
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'product-name-error' : undefined}
              />
              {errors.name ? (
                <p className="field-error" id="product-name-error">{errors.name}</p>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="product-sku">SKU</label>
              <input
                id="product-sku"
                className="field-input"
                value={draft.sku}
                onChange={(event) => setField('sku', event.target.value)}
                placeholder="KIL-1001"
                aria-invalid={Boolean(errors.sku)}
                aria-describedby={errors.sku ? 'product-sku-error' : undefined}
              />
              {errors.sku ? (
                <p className="field-error" id="product-sku-error">{errors.sku}</p>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="product-category">Category</label>
              <select
                id="product-category"
                className="field-input"
                value={draft.category}
                onChange={(event) => setField('category', event.target.value)}
                aria-invalid={Boolean(errors.category)}
                aria-describedby={errors.category ? 'product-category-error' : undefined}
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
                {CATEGORIES.includes(draft.category) ? null : (
                  <option value={draft.category}>{draft.category}</option>
                )}
              </select>
              {errors.category ? (
                <p className="field-error" id="product-category-error">{errors.category}</p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="form-section">
          <p className="eyebrow">02 — Pricing &amp; stock</p>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="product-price">Price (₹)</label>
              <input
                id="product-price"
                className="field-input"
                inputMode="decimal"
                value={draft.price}
                onChange={(event) => setField('price', event.target.value)}
                placeholder="0.00"
                aria-invalid={Boolean(errors.price)}
                aria-describedby={errors.price ? 'product-price-error' : undefined}
              />
              {errors.price ? (
                <p className="field-error" id="product-price-error">{errors.price}</p>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="product-stock">Stock</label>
              <input
                id="product-stock"
                className="field-input"
                inputMode="numeric"
                value={draft.stock}
                onChange={(event) => setField('stock', event.target.value)}
                placeholder="0"
                aria-invalid={Boolean(errors.stock)}
                aria-describedby={errors.stock ? 'product-stock-error' : undefined}
              />
              {errors.stock ? (
                <p className="field-error" id="product-stock-error">{errors.stock}</p>
              ) : null}
            </div>

            <div className="field field-span-2">
              <label htmlFor="product-status">Storefront state</label>
              <select
                id="product-status"
                className="field-input"
                value={draft.status}
                onChange={(event) => setField('status', event.target.value)}
              >
                <option value="draft">Draft — hidden from the storefront</option>
                <option value="published">Published — visible on the storefront</option>
              </select>
            </div>
          </div>
        </section>

        <section className="form-section">
          <p className="eyebrow">03 — Attributes</p>
          <div className="form-grid">
            <div className="field field-span-2">
              <label htmlFor="product-color">Colour</label>
              <div className="color-field">
                <Swatch color={draft.color} name={draft.name} size="sm" />
                <input
                  id="product-color"
                  className="field-input"
                  value={draft.color}
                  onChange={(event) => setField('color', event.target.value)}
                  placeholder="Charcoal"
                />
              </div>
              <p className="field-hint">Known colour names render as swatches in the catalog; others fall back to a monogram tile.</p>
            </div>

            <div className="field">
              <label htmlFor="product-size">Size</label>
              <input
                id="product-size"
                className="field-input"
                value={draft.size}
                onChange={(event) => setField('size', event.target.value)}
                placeholder="S–XL"
              />
            </div>

            <div className="field">
              <label htmlFor="product-material">Material</label>
              <input
                id="product-material"
                className="field-input"
                value={draft.material}
                onChange={(event) => setField('material', event.target.value)}
                placeholder="Heavyweight cotton"
              />
            </div>
          </div>
        </section>

        <section className="form-section">
          <div className="form-section-head">
            <p className="eyebrow">04 — Extra attributes</p>
            <button type="button" className="text-button" onClick={addAttribute}>
              Add attribute
            </button>
          </div>
          <p className="field-hint">
            Free-form options such as Finish or Ports. Sent to WooCommerce as attribute options in the sync payload.
          </p>
          {errors.attributes ? <p className="field-error">{errors.attributes}</p> : null}

          {draft.attributes.length === 0 ? (
            <p className="muted">No extra attributes. Add one for things like Finish or Fit.</p>
          ) : (
            <div className="attribute-rows">
              {draft.attributes.map((attribute, index) => (
                <div className="attribute-row" key={attribute.id}>
                  <input
                    id={`attribute-name-${index}`}
                    className="field-input"
                    value={attribute.name}
                    onChange={(event) => setAttribute(index, { name: event.target.value })}
                    placeholder="Attribute name"
                    aria-label={`Attribute ${index + 1} name`}
                  />
                  <input
                    className="field-input"
                    value={attribute.valuesText}
                    onChange={(event) => setAttribute(index, { valuesText: event.target.value })}
                    placeholder="Values, comma separated"
                    aria-label={`Attribute ${index + 1} values`}
                  />
                  <button
                    type="button"
                    className="text-button text-button-danger"
                    onClick={() => removeAttribute(index)}
                    aria-label={`Remove attribute ${index + 1}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="form-section">
          <p className="eyebrow">05 — Description</p>
          <div className="field">
            <label htmlFor="product-description" className="visually-hidden">Description</label>
            <textarea
              id="product-description"
              className="field-input field-textarea"
              rows={4}
              value={draft.description}
              onChange={(event) => setField('description', event.target.value)}
              placeholder="Short catalog description — material stories, care notes, provenance."
            />
          </div>
        </section>

        {product ? (
          <section className="form-section">
            <p className="eyebrow">Sync record</p>
            <div className="sync-record">
              {syncMode === 'live' ? <Badge tone="error">Live mode</Badge> : <SimulatedBadge />}
              <p>
                {product.wooId
                  ? `${syncMode === 'live' ? 'WooCommerce ID' : 'Demo store ID'} #${product.wooId}`
                  : 'Not yet synced'}
                {product.lastSyncedAt
                  ? ` · last run ${new Date(product.lastSyncedAt).toLocaleString()}`
                  : ' · no successful run recorded'}
              </p>
            </div>
          </section>
        ) : null}
      </form>
    </Drawer>
  )
}
