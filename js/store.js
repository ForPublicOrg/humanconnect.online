// ============================================================================
// Storage adapter. Two implementations behind one tiny API:
//
//   store.mode                     'live' (Firestore) | 'demo' (this browser)
//   store.create({k,a,b,c,lat,lng,durationMs,startInMs}) -> Promise<{id, secret}>
//   store.join(id)                 -> Promise<{already}>
//   store.watch(id, cb)            -> unsubscribe  (cb(event | null), live)
//   store.update({id,secret,k,a,b,c,durationMs,startInMs?}) -> Promise<{expiresAt,startAt}>
//   store.remove(id, secret)       -> Promise<void>
//
// Both push the full list of live events to onEvents(list) whenever anything
// changes. Event shape: { id, k, a, b, c, lat, lng, joins, createdAt, startAt,
// expiresAt } with times in epoch milliseconds. startAt is null when the
// creator didn't pick a time; when set it is never after expiresAt. `k` is the
// kind — 0 for a plan, 1 for a help request — and is always a number here even
// though plans carry no such field in Firestore (see sanitize).
//
// READS come straight from Firestore, live, exactly as before. WRITES go
// through /api/* instead: they need a Cloudflare Turnstile token and limits
// keyed on identity the server derives, neither of which a page can fake.
// See api/_lib/config.js for the numbers and why they are what they are.
// ============================================================================

import { firebaseConfig, appCheckSiteKey, MAX_EVENTS } from './config.js?v=msmfhh75';
import { isValidCombo, isKind, KIND_EVENT, KIND_HELP } from './words.js?v=msmfhh75';
import { geohash4 } from './geo.js?v=msmfhh75';
import { getTurnstileToken } from './turnstile.js?v=msmfhh75';

const FIREBASE_VER = '11.6.1';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VER}`;

// ---------------------------------------------------------------------------
// Talking to the write API
// ---------------------------------------------------------------------------
const apiError = (code, message) => Object.assign(new Error(message || code), { code });

async function apiPost(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
    });
  } catch {
    throw apiError('offline', 'Could not reach the server.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok || data?.ok === false) {
    const e = apiError(data?.error || 'server_error', data?.message || `HTTP ${res.status}`);
    if (typeof data?.retryAfterMs === 'number') e.retryAfterMs = data.retryAfterMs;
    throw e;
  }
  return data ?? {};
}

/**
 * A per-browser id, sent with joins so an honest visitor is counted once even
 * if they tap twice or reopen the link. It is NOT a security control — a new
 * incognito window mints a new one, which is precisely why the server also
 * caps joins per network. When storage is unavailable we use a per-session
 * value rather than a shared constant, so several blocked-storage visitors
 * behind one address don't collapse into a single "device".
 */
let sessionDevice = null;
function deviceId() {
  try {
    let v = localStorage.getItem('hc-device');
    if (!v) {
      v = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem('hc-device', v);
    }
    return v;
  } catch {
    sessionDevice ??= `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    return sessionDevice;
  }
}

/**
 * Turnstile hands out single-use tokens, so an expired one is an ordinary
 * event (a create sheet left open while someone picked a spot). Retry once
 * with a fresh token before bothering the user about it.
 */
async function withToken(action, send) {
  try {
    return await send(await getTurnstileToken(action));
  } catch (err) {
    if (err?.code !== 'verification_stale') throw err;
    return send(await getTurnstileToken(action));
  }
}

export async function createStore({ onEvents, seedCenter, initialCells }) {
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    try {
      return await createFirestoreStore(onEvents, initialCells);
    } catch (err) {
      console.warn('[humanconnect] Firestore init failed, falling back to demo mode:', err);
    }
  }
  return createDemoStore(onEvents, seedCenter);
}

// Drop anything malformed or expired — defense in depth on top of the rules.
// The g4 check stops cell-spoofing: an event claiming a geohash cell that
// doesn't match its coordinates is discarded on read.
//
// Also the one place `k` is settled. A missing `k` is a plan (that is what
// every event written before help requests existed is), but an UNRECOGNISED
// one is dropped rather than shown as a plan: its {a,b,c} would index into the
// wrong word lists, which is exactly the kind of wrong name this whole system
// exists to prevent. So a build that predates a future kind simply doesn't
// draw it. Everything downstream can then rely on ev.k being a real kind.
function sanitize(list) {
  const now = Date.now();
  const out = [];
  for (const ev of list) {
    if (!ev) continue;
    const k = ev.k == null ? KIND_EVENT : ev.k;
    if (
      isKind(k) &&
      isValidCombo(k, ev.a, ev.b, ev.c) &&
      typeof ev.lat === 'number' && ev.lat >= -90 && ev.lat <= 90 &&
      typeof ev.lng === 'number' && ev.lng >= -180 && ev.lng <= 180 &&
      typeof ev.expiresAt === 'number' && ev.expiresAt > now &&
      // Optional, but if present it has to obey the rule the API enforces:
      // nothing may be scheduled for after it has left the map.
      (ev.startAt == null || (typeof ev.startAt === 'number' && ev.startAt <= ev.expiresAt)) &&
      Number.isInteger(ev.joins) && ev.joins >= 0 &&
      ev.g4 === geohash4(ev.lat, ev.lng)
    ) {
      out.push(ev.k === k ? ev : { ...ev, k });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Live store — Firestore
// ---------------------------------------------------------------------------
async function createFirestoreStore(onEvents, initialCells) {
  // Core SDK — REQUIRED. If either of these fails to load we genuinely can't
  // run live, so createStore() falls back to demo mode. App Check is loaded
  // separately (below), never here: ad blockers and privacy modes routinely
  // block reCAPTCHA / the App Check chunk, and that must NOT take the whole
  // live app down with it.
  const [{ initializeApp }, fs] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);
  const {
    getFirestore, initializeFirestore,
    persistentLocalCache, persistentMultipleTabManager,
    collection, query, where, orderBy, limit,
    onSnapshot, getDoc, doc, Timestamp,
  } = fs;

  const app = initializeApp(firebaseConfig);

  // App Check: proves requests come from this site in a real browser, so bots
  // can't script Firestore with the public config. It is BEST EFFORT. Ad
  // blockers, Brave/incognito shields and privacy extensions frequently block
  // reCAPTCHA or the App Check SDK; when that happens we stay in LIVE mode and
  // just run without a token, instead of dropping the user into demo mode (a
  // confusing banner over a site that is actually live). Since writes moved to
  // /api/*, the only thing App Check can still guard is READ volume — and the
  // only consequence of a missing token is that this browser's reads are
  // denied if enforcement is ON. See README → Abuse protection.
  //
  // Initialized in PARALLEL, deliberately not awaited: awaiting the import +
  // reCAPTCHA setup used to sit between the SDK load and the first query,
  // adding a round trip to every cold start. With enforcement OFF a token-less
  // first request is fine; with enforcement ON the very first listen may be
  // denied and retried once the token arrives — still cheaper than making
  // every visitor wait on reCAPTCHA before seeing any events.
  if (appCheckSiteKey) {
    import(`${CDN}/firebase-app-check.js`)
      .then(({ initializeAppCheck, ReCaptchaV3Provider }) => {
        initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(appCheckSiteKey),
          isTokenAutoRefreshEnabled: true,
        });
      })
      .catch((err) => {
        console.warn(
          '[humanconnect] App Check could not initialize — usually an ad blocker ' +
          'or privacy mode blocking reCAPTCHA. Staying in live mode without it. If ' +
          "App Check enforcement is ON, this browser's reads/writes may be denied.",
          err,
        );
      });
  } else {
    // Worth noting, not alarming: writes are protected by Turnstile + the
    // server-side limits regardless. Without App Check, READS are open to any
    // script holding the public config. See README → Abuse protection.
    console.info(
      '[humanconnect] App Check is OFF (appCheckSiteKey is empty) — Firestore ' +
      'reads are open to any script using the public config. Writes are ' +
      'unaffected: they go through /api/* and require Turnstile.',
    );
  }

  // (Anonymous auth used to run here, purely to give the delete rule a uid to
  // check. Writes are server-side now and ownership is a secret issued by
  // /api/create, so the whole auth round trip — and its SDK chunk — is gone.)

  // Local-first cache: returning visitors paint events from IndexedDB
  // instantly while the live listen catches up, instead of staring at
  // "finding events…" until the server answers. Multi-tab manager so a second
  // open tab shares the cache rather than losing the persistence lease. If
  // IndexedDB is unavailable (some private modes), fall back to memory cache.
  let db;
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (err) {
    console.warn('[humanconnect] persistent cache unavailable — using memory cache:', err);
    db = getFirestore(app);
  }
  const events = collection(db, 'events');

  const toEvent = (d) => {
    const v = d.data();
    return {
      id: d.id,
      a: v.a, b: v.b, c: v.c,
      // Absent on plans — including every event written before help requests
      // existed. sanitize() turns that into KIND_EVENT.
      k: v.k,
      lat: v.lat, lng: v.lng,
      g4: v.g4,
      joins: v.joins,
      // Absent on every event created before start times existed, and on any
      // event whose creator didn't pick one — null, never 0, so "no time set"
      // can't be mistaken for 1970.
      startAt: v.startAt?.toMillis?.() ?? null,
      expiresAt: v.expiresAt?.toMillis?.() ?? 0,
      // The anchor of the 7-day ceiling — editing measures the stay from
      // here, never from "now". Null for a beat right after creating (the
      // serverTimestamp hasn't echoed back yet), which just hides Edit.
      createdAt: v.created?.toMillis?.() ?? null,
    };
  };

  let unsub = null;
  // Start scoped to the caller's estimated viewport cells when available, so
  // the FIRST listen is already the one we want. Previously the store always
  // opened a nationwide listen that app.js tore down moments later for the
  // scoped one — paying the first-response latency twice on every load.
  let areaCells = initialCells?.length ? initialCells.slice(0, 30) : null; // null = nationwide fallback (capped)
  let subscribedCells = areaCells ? new Set(areaCells) : null;             // Set currently subscribed; null = global

  const subscribe = () => {
    if (unsub) unsub();
    // Viewport-scoped when we have cells; capped nationwide query otherwise.
    // Order ASCENDING by expiresAt: if we ever hit the 500 cap, we keep the
    // soonest-expiring (most relevant) events and DROP the ones with the most
    // time left. This also defuses a flooding attack — junk events created
    // with the maximum 7-day expiry sort to the bottom and get cut first,
    // instead of monopolising the window as they would under 'desc'.
    const parts = [
      where('expiresAt', '>', Timestamp.now()),
      orderBy('expiresAt', 'asc'),
      limit(MAX_EVENTS),
    ];
    if (areaCells) parts.unshift(where('g4', 'in', areaCells));
    unsub = onSnapshot(query(events, ...parts), (snap) => {
      // An EMPTY snapshot served from cache means "never seen this area", not
      // "no events here" — don't flash 'No events here yet' while the server
      // is still being asked. Cached events, by contrast, paint immediately.
      if (snap.metadata.fromCache && snap.empty) return;
      const list = snap.docs.map(toEvent);
      const clean = sanitize(list);
      // If a full result set collapses to almost nothing after sanitize, the
      // cell is likely being flooded with coord/g4-mismatch junk — surface it
      // rather than silently blanking the map. (Rules can't recompute a
      // geohash, so mismatches are a client-side drop; see README.)
      if (snap.size >= MAX_EVENTS && clean.length < snap.size * 0.5) {
        console.warn(
          `[humanconnect] ${snap.size - clean.length}/${snap.size} events in view ` +
          'were dropped as invalid — possible flooding. Enable App Check enforcement.',
        );
      }
      onEvents(clean);
    }, (err) => console.error('[humanconnect] snapshot error:', err));
  };
  subscribe();

  // The 'expiresAt > now' bound is frozen at subscribe time; refresh it when
  // the tab comes back after being hidden a while, so long-lived tabs stay lean.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (Date.now() - hiddenAt > 10 * 60e3) subscribe();
  });

  return {
    mode: 'live',
    // cells: array of 4-char geohashes covering the viewport, or null for
    // the nationwide fallback. Firestore 'in' allows max 30 values.
    setArea(cells) {
      if (!cells || !cells.length) {
        if (subscribedCells === null) return; // already global
        subscribedCells = null;
        areaCells = null;
        subscribe();
        return;
      }
      const want = cells.slice(0, 30);
      // Reuse the live listener when the new viewport is already fully covered
      // by the current subscription — panning back and forth costs no reads.
      if (subscribedCells && want.every((c) => subscribedCells.has(c))) return;
      subscribedCells = new Set(want);
      areaCells = want;
      subscribe();
    },
    async get(id) {
      try {
        const snap = await getDoc(doc(db, 'events', id));
        if (!snap.exists()) return null;
        const [ev] = sanitize([toEvent(snap)]);
        return ev ?? null;
      } catch (err) {
        console.error('[humanconnect] get() failed:', err);
        return null;
      }
    },
    /**
     * Live listener on ONE event, for as long as its detail sheet is open.
     *
     * The map's listener is scoped to the viewport and capped at MAX_EVENTS,
     * so it is not a reliable source of truth for the event someone is
     * actually looking at: an event opened from a shared link is usually
     * outside those cells entirely, and a busy area can push it past the cap.
     * Either way the joins arriving from other people's phones would never
     * reach the open sheet, which looked like a screen that had frozen.
     *
     * Calls back with the event, or null once it is gone or has expired.
     * Returns an unsubscribe function.
     */
    watch(id, onEvent) {
      return onSnapshot(doc(db, 'events', id), (snap) => {
        if (!snap.exists()) { onEvent(null); return; }
        const [ev] = sanitize([toEvent(snap)]);
        onEvent(ev ?? null);
      }, (err) => console.error('[humanconnect] watch failed:', err));
    },
    // Writes go to /api/*, never to Firestore directly — the rules deny
    // client writes outright. The snapshot listener above picks the result up
    // a moment later, so nothing here has to touch the local event list.
    async create({ k = KIND_EVENT, a, b, c, lat, lng, durationMs, startInMs = null }) {
      const out = await withToken('create', (token) =>
        apiPost('/api/create', { k, a, b, c, lat, lng, durationMs, startInMs, token }));
      // The secret is the ONLY proof of ownership; it exists in this browser
      // and nowhere else. Losing it just means the event runs its full course.
      return { id: out.id, secret: out.secret };
    },
    async join(id) {
      return withToken('join', (token) =>
        apiPost('/api/join', { id, token, device: deviceId() }));
    },
    // Owner-only, like remove: the secret is the proof, no Turnstile needed.
    // startInMs is tri-state — omit the key to keep the current start time,
    // null to clear it, a number (offset from now) to set a new one.
    // durationMs is the TOTAL stay; the server anchors it at creation time.
    // `k` is sent so the server can validate the words against the right lists,
    // and is refused if it disagrees with the stored kind — never applied.
    async update(payload) {
      return apiPost('/api/update', payload);
    },
    // Owner-only: the server compares a hash of this secret against the one
    // stored when the event was created.
    async remove(id, secret) {
      await apiPost('/api/remove', { id, secret });
    },
  };
}

// ---------------------------------------------------------------------------
// Demo store — localStorage + BroadcastChannel (no backend needed)
// ---------------------------------------------------------------------------
function createDemoStore(onEvents, seedCenter) {
  const KEY = 'hc-demo-events';
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('hc-demo') : null;

  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch { return []; }
  };
  const save = (list) => {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
  };
  const emit = () => onEvents(sanitize(load()));

  // Purge expired/malformed (like TTL would in live mode); seed when empty
  // so the first visit — and any visit after everything expired — shows
  // the product working.
  {
    let list = sanitize(load());
    if (!list.length) list = seedEvents(seedCenter);
    save(list);
  }

  if (channel) channel.onmessage = emit;
  queueMicrotask(emit);

  const mutate = (fn) => {
    const list = sanitize(load());
    fn(list);
    save(list);
    channel?.postMessage('sync');
    emit();
  };

  return {
    mode: 'demo',
    setArea() { /* demo data is tiny — no viewport scoping needed */ },
    // Every demo mutation re-emits the whole list to onEvents, and the list is
    // never viewport-scoped, so an open sheet is already live here.
    watch() { return () => {}; },
    async get(id) { return sanitize(load()).find((e) => e.id === id) ?? null; },
    async create({ k = KIND_EVENT, a, b, c, lat, lng, durationMs, startInMs = null }) {
      const id = 'demo-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const now = Date.now();
      mutate((list) => list.push({
        id, k, a, b, c, lat, lng,
        g4: geohash4(lat, lng),
        joins: 0,
        createdAt: now,
        startAt: startInMs == null ? null : now + startInMs,
        expiresAt: now + durationMs,
      }));
      // No server, so no real ownership token — a placeholder keeps the UI's
      // "do I own this?" check uniform across both stores.
      return { id, secret: 'demo' };
    },
    async join(id) {
      let found = false;
      mutate((list) => {
        const ev = list.find((e) => e.id === id);
        if (ev) { ev.joins += 1; found = true; }
      });
      // Joining a removed/expired event must FAIL so the UI's optimistic
      // "You're in ✓" rolls back instead of persisting against nothing.
      if (!found) { const err = new Error('event gone'); err.code = 'not-found'; throw err; }
      return { already: false };
    },
    // Same rules as the API: the stay is anchored at creation, a start time
    // stranded past the new expiry is cleared rather than kept, and the kind
    // is not editable.
    async update({ id, k = KIND_EVENT, a, b, c, durationMs, startInMs }) {
      const now = Date.now();
      let out = null;
      mutate((list) => {
        const ev = list.find((e) => e.id === id);
        if (!ev || ev.createdAt == null) return;
        if ((ev.k ?? KIND_EVENT) !== k) return;
        const expiresAt = ev.createdAt + durationMs;
        if (expiresAt <= now) return;
        ev.a = a; ev.b = b; ev.c = c;
        ev.expiresAt = expiresAt;
        if (startInMs !== undefined) ev.startAt = startInMs == null ? null : now + startInMs;
        if (ev.startAt != null && ev.startAt > expiresAt) ev.startAt = null;
        out = { expiresAt: ev.expiresAt, startAt: ev.startAt };
      });
      if (!out) { const err = new Error('event gone'); err.code = 'not-found'; throw err; }
      return out;
    },
    // Demo has no server identity — the UI's own "mine" tracking is the gate.
    async remove(id) {
      mutate((list) => {
        const i = list.findIndex((e) => e.id === id);
        if (i !== -1) list.splice(i, 1);
      });
    },
  };
}

// A few nearby sample pins so the very first visit shows the product — plans
// and help requests both, since the map holds the two side by side.
function seedEvents(center) {
  const { lat, lng } = center || { lat: 22.5, lng: 78.9 };
  const h = 3600e3;
  // Fresh id per seeding run so reused seeds never collide with a returning
  // visitor's persisted hc-joined set (which would mark them already joined).
  const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // startInMs is optional and always <= ttlMs, mirroring the rule the API
  // enforces: nothing may begin after it has left the map.
  const mk = (k, dLat, dLng, a, b, c, joins, ttlMs, startInMs = null) => ({
    id: `seed-${nonce}-${k}-${b}`,
    k, a, b, c,
    lat: lat + dLat, lng: lng + dLng,
    g4: geohash4(lat + dLat, lng + dLng),
    joins,
    startAt: startInMs == null ? null : Date.now() + startInMs,
    expiresAt: Date.now() + ttlMs,
  });
  const E = KIND_EVENT;
  const S = KIND_HELP;
  return [
    mk(E,  0.010,  0.012, 0,  3, -1, 12, 14 * h, 12 * h),      // Morning Yoga
    mk(E, -0.008,  0.006, 1,  9,  2, 47, 6 * h, 2 * h),        // Evening Cricket Match
    mk(E,  0.004, -0.011, 6, 73,  8,  8, 2 * 24 * h, 22 * h),  // Community Cleanup Drive
    mk(E, -0.013, -0.007, -1, 30, 0,  3, 20 * h),              // Coffee Meetup — starts now
    mk(E,  0.016, -0.003, 5, 55, 18, 0, 4 * 24 * h, 2 * 24 * h), // Weekend Photography Walkathon
    mk(E, -0.002,  0.017, 4, 82, -1, 21, 30 * h, 6 * h),       // Night Gaming
    mk(S,  0.006, -0.004, 0, 82,  0,  4, 12 * h),              // Urgent O Positive Blood Needed
    mk(S, -0.011,  0.013, 10, 19, 4,  0, 3 * h),               // Roadside Flat Tyre Help
  ];
}
