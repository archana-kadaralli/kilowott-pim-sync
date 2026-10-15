import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyTheme,
  prefersDark,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  THEME_KEY,
  toggleTheme,
} from '../src/lib/theme.js'

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

function withFakeWindow(windowLike, run) {
  const previousWindow = globalThis.window
  globalThis.window = windowLike
  try {
    return run()
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
}

test('resolveTheme prefers a stored choice over the system preference', () => {
  assert.equal(resolveTheme('dark', false), 'dark')
  assert.equal(resolveTheme('light', true), 'light')
})

test('resolveTheme falls back to the system preference when nothing is stored', () => {
  assert.equal(resolveTheme(null, true), 'dark')
  assert.equal(resolveTheme(null, false), 'light')
  assert.equal(resolveTheme('sepia', true), 'dark')
})

test('toggleTheme flips between light and dark', () => {
  assert.equal(toggleTheme('light'), 'dark')
  assert.equal(toggleTheme('dark'), 'light')
  assert.equal(toggleTheme(undefined), 'dark')
})

test('readStoredTheme and storeTheme round-trip through localStorage', () => {
  const fake = makeFakeStorage()
  withFakeWindow({ localStorage: fake }, () => {
    assert.equal(readStoredTheme(), null)
    storeTheme('dark')
    assert.equal(fake.map.get(THEME_KEY), '"dark"')
    assert.equal(readStoredTheme(), 'dark')
    storeTheme('light')
    assert.equal(readStoredTheme(), 'light')
  })
})

test('readStoredTheme ignores malformed or unknown stored values', () => {
  withFakeWindow({ localStorage: makeFakeStorage({ [THEME_KEY]: 'not-json' }) }, () => {
    assert.equal(readStoredTheme(), null)
  })
  withFakeWindow({ localStorage: makeFakeStorage({ [THEME_KEY]: '"sepia"' }) }, () => {
    assert.equal(readStoredTheme(), null)
  })
})

test('storeTheme ignores values that are not light or dark', () => {
  const fake = makeFakeStorage()
  withFakeWindow({ localStorage: fake }, () => {
    storeTheme('sepia')
    storeTheme(null)
    assert.equal(fake.map.has(THEME_KEY), false)
  })
})

test('storage helpers degrade gracefully without a browser window', () => {
  assert.equal(readStoredTheme(), null)
  assert.equal(prefersDark(), false)
  assert.doesNotThrow(() => storeTheme('dark'))
})

test('prefersDark reads the system media query when available', () => {
  withFakeWindow({ matchMedia: () => ({ matches: true }) }, () => {
    assert.equal(prefersDark(), true)
  })
  withFakeWindow({ matchMedia: () => ({ matches: false }) }, () => {
    assert.equal(prefersDark(), false)
  })
  withFakeWindow({}, () => {
    assert.equal(prefersDark(), false)
  })
})

test('applyTheme writes the resolved theme onto the given root element', () => {
  const root = { dataset: {} }
  applyTheme('dark', root)
  assert.equal(root.dataset.theme, 'dark')
  applyTheme('light', root)
  assert.equal(root.dataset.theme, 'light')
  applyTheme('unexpected', root)
  assert.equal(root.dataset.theme, 'light')
})

test('applyTheme does nothing without a usable root', () => {
  assert.doesNotThrow(() => applyTheme('dark', null))
  assert.doesNotThrow(() => applyTheme('dark', {}))
})
