// ============================================================================
// Cloudflare Turnstile — the client half.
//
// Design goals, in order:
//   1. Passive visitors pay nothing. The script is fetched the first time
//      someone actually intends to write (opens the create sheet, taps Join),
//      never on page load — the map stays as fast as it was.
//   2. Invisible unless it has to be. `appearance: 'interaction-only'` keeps
//      the widget at zero size for the overwhelming majority; it only draws
//      itself when Cloudflare decides this visitor needs a real challenge.
//   3. Never fatal by surprise. Blocked, slow, or failed verification rejects
//      with a code the UI can turn into a sentence, instead of hanging.
//
// A token is single-use and short-lived, so each write asks for a fresh one.
// ============================================================================

import { turnstileSiteKey } from './config.js?v=msmfhh75';

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__hcTurnstileReady';
const READY_CALLBACK = '__hcTurnstileReady';
const LOAD_TIMEOUT_MS = 15000;
const SOLVE_TIMEOUT_MS = 30000;

export const turnstileEnabled = () => Boolean(turnstileSiteKey);

const err = (code, message) => Object.assign(new Error(message), { code });

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------
let loading = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(err('verification_unavailable', 'Turnstile took too long to load.')),
      LOAD_TIMEOUT_MS,
    );
    window[READY_CALLBACK] = () => { clearTimeout(timer); resolve(window.turnstile); };
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      clearTimeout(timer);
      reject(err('verification_unavailable', 'Turnstile could not be loaded.'));
    };
    document.head.appendChild(s);
  });

  // A blocked or flaky first load must not poison every later attempt —
  // forget the failure so the next Join can try again.
  loading.catch(() => { loading = null; });
  return loading;
}

// ---------------------------------------------------------------------------
// Widgets — one per action, so a token minted for 'join' can never be spent
// on 'create' (the API checks the binding).
// ---------------------------------------------------------------------------
const widgets = new Map();

function hostEl() {
  let host = document.getElementById('turnstile-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'turnstile-host';
    document.body.appendChild(host);
  }
  return host;
}

/**
 * An interaction-only widget occupies zero pixels until Cloudflare decides
 * this visitor must actually do something — at which point it needs to be
 * both visible and the only thing you can tap. Rather than guessing, watch
 * for the box gaining height and let the scrim follow reality; that way the
 * overlay never flashes on the (overwhelmingly common) invisible pass.
 */
function watchVisibility(box) {
  if (typeof ResizeObserver !== 'function') return;
  new ResizeObserver(() => {
    const visible = [...widgets.values()].some((w) => w.box.offsetHeight > 0);
    hostEl().classList.toggle('challenging', visible);
  }).observe(box);
}

function widgetFor(ts, action) {
  let w = widgets.get(action);
  if (w) return w;

  const box = document.createElement('div');
  box.className = 'cf-widget';
  hostEl().appendChild(box);

  w = { box, id: null, used: false, settle: null, inflight: null };
  w.id = ts.render(box, {
    sitekey: turnstileSiteKey,
    action,
    execution: 'execute',        // nothing happens until we ask
    appearance: 'interaction-only',
    theme: 'auto',
    retry: 'never',              // we own the retry story, not the widget
    callback: (token) => w.settle?.ok(token),
    'error-callback': () => {
      w.settle?.fail(err('verification_failed', 'Verification failed.'));
      return true;               // suppress Turnstile's own error UI
    },
    'timeout-callback': () => w.settle?.fail(err('verification_timeout', 'Verification timed out.')),
    'expired-callback': () => w.settle?.fail(err('verification_stale', 'Verification expired.')),
  });

  widgets.set(action, w);
  watchVisibility(box);
  return w;
}

function solve(ts, w) {
  if (w.inflight) return w.inflight;

  w.inflight = new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      w.settle = null;
      w.inflight = null;
      fn(value);
    };
    const timer = setTimeout(
      () => finish(reject, err('verification_timeout', 'Verification timed out.')),
      SOLVE_TIMEOUT_MS,
    );
    w.settle = { ok: (t) => finish(resolve, t), fail: (e) => finish(reject, e) };

    try {
      // Tokens are single-use: everything after the first solve needs a reset.
      if (w.used) ts.reset(w.id);
      w.used = true;
      ts.execute(w.id);
    } catch (e) {
      finish(reject, err('verification_unavailable', String(e?.message || e)));
    }
  });

  return w.inflight;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * A fresh single-use token for `action` ('create' | 'join').
 * Rejects with `.code` in: verification_unavailable | verification_failed |
 * verification_timeout | verification_stale.
 */
export async function getTurnstileToken(action) {
  if (!turnstileSiteKey) {
    // Distinct from "blocked" — this is a deployment that never set the key,
    // and telling the user to check their ad blocker would be a lie.
    throw err('verification_unconfigured', 'Turnstile site key is not configured.');
  }
  const ts = await loadTurnstile();
  return solve(ts, widgetFor(ts, action));
}

/**
 * Fetch and render ahead of time, on the first hint that a write is coming
 * (hovering the FAB, opening an event). Failures are ignored — this is only
 * ever an optimisation; getTurnstileToken() is where errors matter.
 */
export function warmTurnstile(action) {
  if (!turnstileSiteKey) return;
  loadTurnstile().then((ts) => widgetFor(ts, action)).catch(() => {});
}
