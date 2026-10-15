import { BrandMark, Icon } from './ui'

export default function TopChrome({ view, onNavigate, productCount, pendingCount, theme, onToggleTheme }) {
  return (
    <header className="chrome">
      <div className="chrome-inner">
        <button
          type="button"
          className="brand"
          onClick={() => onNavigate('catalog')}
          aria-label="PIM Sync — back to catalog"
        >
          <BrandMark />
          <span className="brand-text">
            <span className="brand-name">PIM Sync</span>
            <span className="brand-sub">WooCommerce product ops</span>
          </span>
        </button>

        <nav className="chrome-nav" aria-label="Workspace">
          <button
            type="button"
            className={`tab${view === 'catalog' ? ' tab-active' : ''}`}
            aria-current={view === 'catalog' ? 'page' : undefined}
            onClick={() => onNavigate('catalog')}
          >
            Catalog
            <span className="tab-count">{productCount}</span>
          </button>
          <button
            type="button"
            className={`tab${view === 'sync' ? ' tab-active' : ''}`}
            aria-current={view === 'sync' ? 'page' : undefined}
            onClick={() => onNavigate('sync')}
          >
            Synchronize
            {pendingCount > 0 ? <span className="tab-count tab-count-alert">{pendingCount}</span> : null}
          </button>
        </nav>

        <div className="chrome-actions">
          <button
            type="button"
            className="icon-button"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
          </button>
        </div>
      </div>
    </header>
  )
}
