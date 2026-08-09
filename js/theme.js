// ============================================================================
// Theme control. Three modes: 'system' (default), 'light', 'dark'.
//
// The header toggle flips between light/dark; until the user touches it the
// site follows the OS. The chosen mode is applied as a `data-theme` attribute
// on <html> (CSS reads it) and broadcast to listeners like the map engine,
// which must re-style tiles and the India boundary to match.
//
// A tiny inline script in <head> applies the stored mode before first paint
// (no flash); this module is the full, idempotent implementation.
// ============================================================================

const KEY = 'hc-theme';
const mql = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

let mode = load();

function load() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch { return 'system'; }
}

export function effectiveTheme() {
  return mode === 'system' ? (mql.matches ? 'dark' : 'light') : mode;
}

export function getMode() { return mode; }

function apply() {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  // Hint native UI (form controls, scrollbars) to match.
  root.style.colorScheme = effectiveTheme();
}

function notify() {
  const t = effectiveTheme();
  listeners.forEach((cb) => cb(t));
}

/** Subscribe to effective-theme changes. Returns an unsubscribe fn. */
export function onThemeChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Flip to the opposite of the current effective theme (becomes explicit). */
export function toggleTheme() {
  mode = effectiveTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(KEY, mode); } catch {}
  apply();
  notify();
}

// While in 'system' mode, track OS changes live.
mql.addEventListener?.('change', () => {
  if (mode === 'system') { apply(); notify(); }
});

apply();
