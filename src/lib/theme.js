export const THEME_KEY = 'kilowott-pim-sync/theme/v1'

export function resolveTheme(stored, systemPrefersDark) {
  if (stored === 'light' || stored === 'dark') return stored
  return systemPrefersDark ? 'dark' : 'light'
}

export function toggleTheme(current) {
  return current === 'dark' ? 'light' : 'dark'
}

export function readStoredTheme() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const raw = window.localStorage.getItem(THEME_KEY)
    const value = raw ? JSON.parse(raw) : null
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export function storeTheme(theme) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    if (theme !== 'light' && theme !== 'dark') return
    window.localStorage.setItem(THEME_KEY, JSON.stringify(theme))
  } catch {
    return
  }
}

export function prefersDark() {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  } catch {
    return false
  }
}

export function applyTheme(theme, root) {
  const target = root ?? (typeof document !== 'undefined' ? document.documentElement : null)
  if (!target || !target.dataset) return
  target.dataset.theme = theme === 'dark' ? 'dark' : 'light'
}
