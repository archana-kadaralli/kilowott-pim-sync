import { useEffect, useRef } from 'react'
import { initialsFor, monogramTint, swatchFor } from '../lib/products'

export function Icon({ name, size = 16 }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'square',
    strokeLinejoin: 'miter',
    'aria-hidden': true,
  }
  switch (name) {
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m15.8 15.8 4.2 4.2" />
        </svg>
      )
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      )
    case 'close':
      return (
        <svg {...common}>
          <path d="M6 6l12 12" />
          <path d="M18 6 6 18" />
        </svg>
      )
    case 'sun':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
        </svg>
      )
    case 'moon':
      return (
        <svg {...common}>
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        </svg>
      )
    case 'sync':
      return (
        <svg {...common}>
          <path d="M4 12a8 8 0 0 1 13.6-5.7L20 8.5" />
          <path d="M20 4v4.5h-4.5" />
          <path d="M20 12a8 8 0 0 1-13.6 5.7L4 15.5" />
          <path d="M4 20v-4.5h4.5" />
        </svg>
      )
    case 'check':
      return (
        <svg {...common}>
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      )
    case 'alert':
      return (
        <svg {...common}>
          <path d="M12 4 3 20h18L12 4Z" />
          <path d="M12 10v4.5" />
          <path d="M12 17.4v.2" />
        </svg>
      )
    case 'arrow-right':
      return (
        <svg {...common}>
          <path d="M4 12h15" />
          <path d="m14 7 5 5-5 5" />
        </svg>
      )
    case 'pencil':
      return (
        <svg {...common}>
          <path d="m4 20 4.2-1L19 8.2 15.8 5 5 15.8 4 20Z" />
          <path d="m13.8 7 3.2 3.2" />
        </svg>
      )
    case 'trash':
      return (
        <svg {...common}>
          <path d="M4.5 7h15" />
          <path d="M9.5 7V4.8h5V7" />
          <path d="m7 7 1 13h8l1-13" />
          <path d="M10.2 11v5.4M13.8 11v5.4" />
        </svg>
      )
    default:
      return null
  }
}

export function BrandMark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="brand-mark-svg">
      <rect x="3" y="3" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <rect x="3" y="3" width="11" height="11" className="brand-mark-block" />
      <path d="M18 21h8m0 0-3.6-3.6M26 21l-3.6 3.6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" />
    </svg>
  )
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`tag tag-${tone}`}>{children}</span>
}

export function SyncStatusBadge({ status }) {
  const labels = { synced: 'Synced', pending: 'Needs sync', error: 'Sync failed' }
  const tones = { synced: 'success', pending: 'warning', error: 'error' }
  return <Badge tone={tones[status] ?? 'neutral'}>{labels[status] ?? status}</Badge>
}

export function ProductStatusBadge({ status }) {
  return (
    <Badge tone={status === 'published' ? 'ink' : 'neutral'}>
      {status === 'published' ? 'Published' : 'Draft'}
    </Badge>
  )
}

export function SimulatedBadge() {
  return <Badge tone="demo">Simulated demo</Badge>
}

export function Swatch({ color = '', name = '', size = 'md' }) {
  const hex = swatchFor(color)
  if (hex) {
    return (
      <span
        className={`swatch swatch-${size}`}
        style={{ background: hex }}
        role="img"
        aria-label={color ? `${color} swatch` : 'Colour swatch'}
        title={color || undefined}
      />
    )
  }
  return (
    <span
      className={`swatch swatch-${size} swatch-mono`}
      style={{ background: monogramTint(name || color) }}
      role="img"
      aria-label={`${name || 'Product'} placeholder tile`}
    >
      {initialsFor(name)}
    </span>
  )
}

export function Drawer({ eyebrow, title, subtitle, onClose, children, footer }) {
  const panelRef = useRef(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusables = Array.from(
        panelRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      ).filter((element) => !element.disabled && element.getClientRects().length > 0)
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [onClose])

  return (
    <div className="drawer-overlay" onMouseDown={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2 className="drawer-title">{title}</h2>
            {subtitle ? <p className="drawer-subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close panel">
            <Icon name="close" />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <footer className="drawer-foot">{footer}</footer> : null}
      </aside>
    </div>
  )
}

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  const cancelRef = useRef(null)

  useEffect(() => {
    cancelRef.current?.focus()
    function handleKeyDown(event) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <div className="dialog-overlay" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="eyebrow">Confirm action</p>
        <h2 className="dialog-title">{title}</h2>
        {message ? <p className="dialog-message">{message}</p> : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} ref={cancelRef}>
            Keep product
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function EmptyState({ glyph = '—', title, message }) {
  return (
    <div className="empty">
      <p className="empty-glyph" aria-hidden="true">{glyph}</p>
      <p className="empty-title">{title}</p>
      {message ? <p className="empty-message">{message}</p> : null}
    </div>
  )
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />
}
