import { Badge, EmptyState, SimulatedBadge, Spinner, SyncStatusBadge } from './ui'
import {
  LIVE_MODE_WARNING,
  latestSuccessfulRun,
  liveBlockReason,
  SYNC_MODES,
  WOO_SIMULATION_NOTICE,
} from '../lib/woo'

const SYNCED_FIELDS = [
  'Product name and SKU',
  'Price and stock level',
  'Storefront status (Published / Draft)',
  'Description and category',
  'Colour, size and material',
  'Custom attributes (e.g. Finish, Ports)',
]

function formatDateTime(value) {
  if (!value) return null
  return new Date(value).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatTime(value) {
  if (!value) return null
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function modeLabel(mode) {
  return mode === 'live' ? 'Live store' : 'Simulated demo'
}

export default function SyncView({
  products,
  syncLog,
  syncingIds,
  forceFail,
  onForceFailChange,
  onSyncOne,
  onSyncMany,
  syncMode,
  onSyncModeChange,
  liveStatus,
  liveChecking,
  liveCheckedAt,
  onRefreshLiveStatus,
}) {
  const queue = products.filter((product) => product.syncStatus !== 'synced')
  const isBusy = syncingIds.length > 0

  const lastSuccess = latestSuccessfulRun(syncLog)
  const lastDemoSuccess = latestSuccessfulRun(syncLog, 'simulated')
  const lastLiveSuccess = latestSuccessfulRun(syncLog, 'live')
  const demoRuns = syncLog.filter((entry) => entry.mode !== 'live').length
  const liveRuns = syncLog.filter((entry) => entry.mode === 'live').length

  const blockedReason = syncMode === 'live' ? liveBlockReason(liveStatus, liveChecking) : null
  const liveBlocked = syncMode === 'live' && blockedReason !== null
  const connState = liveChecking && !liveStatus
    ? 'checking'
    : liveStatus?.error
      ? 'unreachable'
      : !liveStatus
        ? 'unreachable'
        : liveStatus.configured
          ? 'configured'
          : 'unconfigured'

  function runButtonTitle() {
    if (isBusy) return 'A sync run is already in progress.'
    if (liveBlocked) return blockedReason
    return 'Nothing is waiting to sync — edit a product to queue it.'
  }

  return (
    <div className="view">
      <section className="mast">
        <div className="mast-main">
          <p className="eyebrow">PIM Sync · Synchronization</p>
          <h1 className="mast-title">Synchro&#8203;nize</h1>
          <p className="lede">
            {syncMode === 'live'
              ? 'Live mode sends real REST requests to your store through the local server-side proxy.'
              : 'Demo mode simulates the WooCommerce sync inside this browser — no network requests are made.'}{' '}
            {queue.length === 0
              ? 'Every product is currently in sync.'
              : `${queue.length} of ${products.length} products are waiting for a run.`}
          </p>
        </div>

        <aside className="mast-side" aria-label="Synchronization summary">
          <p className="micro-label">Waiting to sync</p>
          <p className="mast-index">{String(queue.length).padStart(2, '0')}</p>
          <dl className="mast-stats">
            <div className="mast-stat">
              <dt>Mode</dt>
              <dd>{syncMode === 'live' ? 'Live store' : 'Simulated demo'}</dd>
            </div>
            <div className="mast-stat">
              <dt>Runs logged</dt>
              <dd>{syncLog.length}</dd>
            </div>
            <div className="mast-stat mast-stat-wide">
              <dt>Last success</dt>
              <dd>{lastSuccess ? `${modeLabel(lastSuccess.mode)} · ${formatDateTime(lastSuccess.at)}` : 'No runs yet'}</dd>
            </div>
          </dl>
        </aside>
      </section>

      {syncMode === 'simulated' ? (
        <div className="notice notice-demo">
          <SimulatedBadge />
          <p>{WOO_SIMULATION_NOTICE}</p>
        </div>
      ) : connState === 'checking' ? (
        <div className="notice notice-info">
          <Spinner />
          <p>Checking the server configuration…</p>
        </div>
      ) : connState === 'unreachable' ? (
        <div className="notice notice-live">
          <Badge tone="error">Server unreachable</Badge>
          <p>
            {liveStatus?.error} Start the app with <span className="mono">npm run dev</span> (or{' '}
            <span className="mono">npm run preview</span> / <span className="mono">npm start</span>), then press{' '}
            <strong>Check again</strong> in the Connection panel below.
          </p>
        </div>
      ) : connState === 'unconfigured' ? (
        <div className="notice notice-live">
          <Badge tone="error">Live not configured</Badge>
          <p>
            Live mode is selected, but the server has no store credentials yet.{' '}
            {liveStatus?.urlError
              ? liveStatus.urlError
              : `Missing: ${liveStatus?.missing.join(', ')}.`}{' '}
            Complete the setup steps in the Connection panel, restart the server after saving{' '}
            <span className="mono">.env.local</span>, then press <strong>Check again</strong>.
          </p>
        </div>
      ) : (
        <div className="notice notice-live">
          <Badge tone="error">Live mode</Badge>
          <p>{LIVE_MODE_WARNING}</p>
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Connection mode</h2>
          <span className="panel-meta">Where sync runs are pushed</span>
        </div>
        <div className="mode-grid" role="radiogroup" aria-label="Sync target mode">
          {Object.values(SYNC_MODES).map((mode) => {
            const selected = syncMode === mode.id
            return (
              <label key={mode.id} className={`mode-card${selected ? ' mode-card-active' : ''}`}>
                <input
                  type="radio"
                  name="sync-mode"
                  value={mode.id}
                  checked={selected}
                  onChange={() => onSyncModeChange(mode.id)}
                  className="visually-hidden"
                />
                <span className="mode-head">
                  <span className="mode-title">{mode.label}</span>
                  {selected ? <Badge tone="ink">Active</Badge> : null}
                </span>
                <span className="mode-tagline mono">{mode.tagline}</span>
                <span className="mode-desc">{mode.description}</span>
              </label>
            )
          })}
        </div>
      </section>

      <div className="panels">
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Connection</h2>
            {syncMode === 'simulated' ? (
              <SimulatedBadge />
            ) : connState === 'checking' ? (
              <Badge tone="neutral">Checking…</Badge>
            ) : connState === 'unreachable' ? (
              <Badge tone="error">Server unreachable</Badge>
            ) : connState === 'configured' ? (
              <Badge tone="success">Configured</Badge>
            ) : (
              <Badge tone="error">Not configured</Badge>
            )}
          </div>

          {syncMode === 'simulated' ? (
            <>
              <dl className="kv">
                <div>
                  <dt>Store URL</dt>
                  <dd className="muted">Not configured</dd>
                </div>
                <div>
                  <dt>API credentials</dt>
                  <dd className="muted">None needed — nothing leaves the browser</dd>
                </div>
                <div>
                  <dt>Behaviour</dt>
                  <dd>Local payload + deterministic demo IDs</dd>
                </div>
                <div>
                  <dt>Last simulated success</dt>
                  <dd>{lastDemoSuccess ? formatDateTime(lastDemoSuccess.at) : 'None yet'}</dd>
                </div>
                <div>
                  <dt>Last live success</dt>
                  <dd>{lastLiveSuccess ? formatDateTime(lastLiveSuccess.at) : 'None yet — live runs are logged separately'}</dd>
                </div>
              </dl>
              <p className="panel-note">
                Switch to live mode to point sync at a real store. Until then, every run is tagged “Simulated demo” in
                the activity ledger.
              </p>
            </>
          ) : connState === 'unreachable' ? (
            <>
              <dl className="kv">
                <div>
                  <dt>Store</dt>
                  <dd className="muted">Unknown — cannot reach the proxy</dd>
                </div>
                <div>
                  <dt>Credentials</dt>
                  <dd className="muted">Unknown — cannot reach the proxy</dd>
                </div>
                <div>
                  <dt>Last success</dt>
                  <dd>{lastSuccess ? `${modeLabel(lastSuccess.mode)} · ${formatDateTime(lastSuccess.at)}` : 'None yet'}</dd>
                </div>
              </dl>
              <p className="panel-note">{liveStatus?.error}</p>
              <p className="panel-note">
                This is a connection failure, not a missing configuration. Start the app server (for example{' '}
                <span className="mono">npm run dev</span>) and press <strong>Check again</strong>.
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onRefreshLiveStatus}
                disabled={liveChecking}
              >
                {liveChecking ? <Spinner /> : null}
                {liveChecking ? 'Checking…' : 'Check again'}
              </button>
            </>
          ) : connState === 'unconfigured' ? (
            <>
              <dl className="kv">
                <div>
                  <dt>Store</dt>
                  <dd className="muted">Not configured</dd>
                </div>
                <div>
                  <dt>Credentials</dt>
                  <dd className="muted">Missing</dd>
                </div>
                <div>
                  <dt>Last success</dt>
                  <dd>{lastSuccess ? `${modeLabel(lastSuccess.mode)} · ${formatDateTime(lastSuccess.at)}` : 'None yet'}</dd>
                </div>
              </dl>
              {liveStatus?.urlError ? (
                <p className="field-error">{liveStatus.urlError}</p>
              ) : (
                <ul className="missing-list" aria-label="Missing environment variables">
                  {(liveStatus?.missing ?? []).map((name) => (
                    <li key={name}>
                      <Badge tone="warning">{name}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <ol className="setup-steps">
                <li>
                  Create the env file: <span className="mono">Copy-Item .env.example .env.local</span> (PowerShell) or{' '}
                  <span className="mono">cp .env.example .env.local</span>.
                </li>
                <li>
                  Fill in <span className="mono">WOO_STORE_URL</span> (an <span className="mono">https://…</span>{' '}
                  address), <span className="mono">WOO_CONSUMER_KEY</span> and{' '}
                  <span className="mono">WOO_CONSUMER_SECRET</span> — from WooCommerce → Settings → Advanced → REST
                  API.
                </li>
                <li>
                  Restart the server (stop it, then run <span className="mono">npm run dev</span> again). Env files are
                  read at startup, so a restart is required.
                </li>
                <li>
                  Press <strong>Check again</strong> below.
                </li>
              </ol>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onRefreshLiveStatus}
                disabled={liveChecking}
              >
                {liveChecking ? <Spinner /> : null}
                {liveChecking ? 'Checking…' : 'Check again'}
              </button>
            </>
          ) : (
            <>
              <dl className="kv">
                <div>
                  <dt>Store</dt>
                  <dd className="mono">{liveStatus?.storeHost}</dd>
                </div>
                <div>
                  <dt>Credentials</dt>
                  <dd>Held server-side (.env.local) — never sent to the browser</dd>
                </div>
                <div>
                  <dt>Last simulated success</dt>
                  <dd>{lastDemoSuccess ? formatDateTime(lastDemoSuccess.at) : 'None yet'}</dd>
                </div>
                <div>
                  <dt>Last live success</dt>
                  <dd>{lastLiveSuccess ? formatDateTime(lastLiveSuccess.at) : 'None yet'}</dd>
                </div>
              </dl>
              {liveStatus?.insecureLocal ? (
                <p className="panel-note">
                  <Badge tone="warning">Local HTTP (dev only)</Badge> This store URL uses plain HTTP on a local
                  development host, allowed only because <span className="mono">WOO_ALLOW_LOCAL_HTTP=1</span>. Remote
                  stores must use HTTPS.
                </p>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onRefreshLiveStatus}
                disabled={liveChecking}
              >
                {liveChecking ? <Spinner /> : null}
                {liveChecking ? 'Checking…' : 'Check again'}
              </button>
            </>
          )}

          {syncMode === 'live' ? (
            <p className="conn-checked mono">
              Status checked: {liveCheckedAt ? formatTime(liveCheckedAt) : 'not yet'} · Read the{' '}
              <span className="mono">README</span> for the full setup and deployment notes.
            </p>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Run a sync</h2>
            <span className="panel-meta">
              Last successful run: {lastSuccess ? `${modeLabel(lastSuccess.mode)} · ${formatDateTime(lastSuccess.at)}` : 'none yet'}
            </span>
          </div>
          <div className="run-actions">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => onSyncMany(queue)}
              disabled={isBusy || queue.length === 0 || liveBlocked}
              title={queue.length > 0 && !isBusy && !liveBlocked ? `Sync ${queue.length} queued products` : runButtonTitle()}
            >
              {isBusy ? <Spinner /> : null}
              Sync {queue.length === 1 ? '1 product' : `${queue.length} products`}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onSyncMany(products)}
              disabled={isBusy || products.length === 0 || liveBlocked}
              title={runButtonTitle()}
            >
              Sync entire catalog ({products.length})
            </button>
          </div>
          {liveBlocked ? (
            <p className="field-error run-warning">
              {blockedReason} Live sync stays disabled until the server reports a valid configuration.
            </p>
          ) : queue.length === 0 ? (
            <p className="panel-note run-warning">All products are in sync. Edit a product to queue it for the next run.</p>
          ) : null}
          {syncMode === 'simulated' ? (
            <label className="force-fail">
              <input
                type="checkbox"
                checked={forceFail}
                onChange={(event) => onForceFailChange(event.target.checked)}
              />
              <span>
                Fail the next run
                <span className="muted"> — demonstrates the error and retry flow</span>
              </span>
            </label>
          ) : null}
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">What gets synchronized</h2>
          <span className="panel-meta">Fields included in every push</span>
        </div>
        <ul className="field-list">
          {SYNCED_FIELDS.map((field) => (
            <li key={field}>{field}</li>
          ))}
        </ul>
        <p className="panel-note">
          In demo mode each product receives a deterministic demo ID with no network traffic. In live mode the
          WooCommerce product ID returned by the store is saved to the product.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Products waiting to sync</h2>
          <span className="panel-meta">{queue.length} queued</span>
        </div>
        {queue.length === 0 ? (
          <EmptyState glyph="✓" title="Everything is in sync" message="No products are waiting for a sync run." />
        ) : (
          <ul className="queue">
            {queue.map((product) => {
              const isSyncing = syncingIds.includes(product.id)
              return (
                <li key={product.id} className="queue-row">
                  <div className="queue-info">
                    <p className="queue-name">
                      {product.name} <span className="mono muted">{product.sku}</span>
                    </p>
                    <p className="queue-detail">
                      {product.syncStatus === 'error' && product.syncError
                        ? product.syncError
                        : 'Edited or created since the last sync run'}
                    </p>
                  </div>
                  <div className="queue-actions">
                    <SyncStatusBadge status={product.syncStatus} />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onSyncOne(product)}
                      disabled={isSyncing || liveBlocked}
                      title={liveBlocked ? blockedReason : isSyncing ? 'This product is syncing…' : 'Sync now'}
                    >
                      {isSyncing ? <Spinner /> : null}
                      {isSyncing ? 'Syncing' : 'Sync now'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Activity ledger</h2>
          <span className="panel-meta">
            {syncLog.length === 0
              ? '0 recorded runs · stored in this browser'
              : `${syncLog.length} recorded runs — ${demoRuns} simulated / ${liveRuns} live · stored in this browser`}
          </span>
        </div>
        {syncLog.length === 0 ? (
          <EmptyState
            glyph="—"
            title="No sync activity yet"
            message="Each run, success or failure, is recorded here with a timestamp and its mode."
          />
        ) : (
          <ol className="ledger">
            {syncLog.map((entry) => (
              <li key={entry.id} className="ledger-row">
                <time className="ledger-time mono">{formatDateTime(entry.at)}</time>
                <div className="ledger-main">
                  <p className="ledger-name">
                    {entry.name} <span className="mono muted">{entry.sku}</span>
                  </p>
                  <p className="ledger-msg">{entry.message}</p>
                </div>
                <div className="ledger-tags">
                  <Badge tone={entry.outcome === 'success' ? 'success' : 'error'}>
                    {entry.outcome === 'success' ? 'Synced' : 'Failed'}
                  </Badge>
                  <Badge tone={entry.mode === 'live' ? 'error' : 'demo'}>
                    {entry.mode === 'live' ? 'Live store' : 'Simulated demo'}
                  </Badge>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
