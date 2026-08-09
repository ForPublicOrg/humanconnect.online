// ============================================================================
// Storage adapter. Two implementations behind one tiny API:
//
//   store.mode                     'live' (Firestore) | 'demo' (this browser)
//   store.create({a,b,c,lat,lng,durationMs}) -> Promise<id>
//   store.join(id)                 -> Promise<void>
//
// Both push the full list of live events to onEvents(list) whenever anything
// changes. Event shape: { id, a, b, c, lat, lng, joins, expiresAt } with
// expiresAt in epoch milliseconds.
// ============================================================================

import { firebaseConfig, appCheckSiteKey, MAX_EVENTS } from './config.js';
import { isValidCombo } from './words.js';
import { geohash4 } from './geo.js';

const FIREBASE_VER = '11.6.1';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VER}`;

export async function createStore({ onEvents, seedCenter }) {
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    try {
      return await createFirestoreStore(onEvents);
    } catch (err) {
      console.warn('[humanconnect] Firestore init failed, falling back to demo mode:', err);
    }
  }
  return createDemoStore(onEvents, seedCenter);
}

// Drop anything malformed or expired — defense in depth on top of the rules.
// The g4 check stops cell-spoofing: an event claiming a geohash cell that
// doesn't match its coordinates is discarded on read.
function sanitize(list) {
  const now = Date.now();
  return list.filter((ev) =>
    ev &&
    isValidCombo(ev.a, ev.b, ev.c) &&
    typeof ev.lat === 'number' && ev.lat >= -90 && ev.lat <= 90 &&
    typeof ev.lng === 'number' && ev.lng >= -180 && ev.lng <= 180 &&
    typeof ev.expiresAt === 'number' && ev.expiresAt > now &&
    Number.isInteger(ev.joins) && ev.joins >= 0 &&
    ev.g4 === geohash4(ev.lat, ev.lng)
  );
}

// ---------------------------------------------------------------------------
// Live store — Firestore
// ---------------------------------------------------------------------------
async function createFirestoreStore(onEvents) {
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
    getFirestore, collection, query, where, orderBy, limit,
    onSnapshot, getDoc, addDoc, updateDoc, doc, increment,
    serverTimestamp, Timestamp,
  } = fs;

  const app = initializeApp(firebaseConfig);

  // App Check: proves requests come from this site in a real browser, so bots
  // can't script Firestore with the public config. It is BEST EFFORT. Ad
  // blockers, Brave/incognito shields and privacy extensions frequently block
  // reCAPTCHA or the App Check SDK; when that happens we stay in LIVE mode and
  // just run without a token, instead of dropping the user into demo mode (a
  // confusing banner over a site that is actually live). The only consequence
  // of a missing token is server-side: if App Check *enforcement* is ON, this
  // particular browser's reads/writes are denied — see README → Abuse protection.
  if (appCheckSiteKey) {
    try {
      const { initializeAppCheck, ReCaptchaV3Provider } =
        await import(`${CDN}/firebase-app-check.js`);
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(appCheckSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      console.warn(
        '[humanconnect] App Check could not initialize — usually an ad blocker ' +
        'or privacy mode blocking reCAPTCHA. Staying in live mode without it. If ' +
        "App Check enforcement is ON, this browser's reads/writes may be denied.",
        err,
      );
    }
  } else {
    // Loud, not silent: a live deploy with no App Check has ZERO bot
    // protection even though the app "works". See README → Abuse protection.
    console.warn(
      '[humanconnect] App Check is OFF (appCheckSiteKey is empty). Firestore ' +
      'is reachable by any script using the public config. Set appCheckSiteKey ' +
      'in js/config.js and enable enforcement before relying on this in production.',
    );
  }

  const db = getFirestore(app);
  const events = collection(db, 'events');

  const toEvent = (d) => {
    const v = d.data();
    return {
      id: d.id,
      a: v.a, b: v.b, c: v.c,
      lat: v.lat, lng: v.lng,
      g4: v.g4,
      joins: v.joins,
      expiresAt: v.expiresAt?.toMillis?.() ?? 0,
    };
  };

  let unsub = null;
  let areaCells = null;          // null = nationwide fallback (capped)
  let subscribedCells = null;    // Set currently subscribed; null = global

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
    async create({ a, b, c, lat, lng, durationMs }) {
      const ref = await addDoc(events, {
        a, b, c, lat, lng,
        g4: geohash4(lat, lng),
        joins: 0,
        created: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + durationMs),
      });
      return ref.id;
    },
    async join(id) {
      await updateDoc(doc(db, 'events', id), { joins: increment(1) });
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
    async get(id) { return sanitize(load()).find((e) => e.id === id) ?? null; },
    async create({ a, b, c, lat, lng, durationMs }) {
      const id = 'demo-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      mutate((list) => list.push({
        id, a, b, c, lat, lng,
        g4: geohash4(lat, lng),
        joins: 0,
        expiresAt: Date.now() + durationMs,
      }));
      return id;
    },
    async join(id) {
      mutate((list) => {
        const ev = list.find((e) => e.id === id);
        if (ev) ev.joins += 1;
      });
    },
  };
}

// A few nearby sample events so the very first visit shows the product.
function seedEvents(center) {
  const { lat, lng } = center || { lat: 22.5, lng: 78.9 };
  const h = 3600e3;
  // Fresh id per seeding run so reused seeds never collide with a returning
  // visitor's persisted hc-joined set (which would mark them already joined).
  const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const mk = (dLat, dLng, a, b, c, joins, ttlMs) => ({
    id: `seed-${nonce}-${b}`,
    a, b, c,
    lat: lat + dLat, lng: lng + dLng,
    g4: geohash4(lat + dLat, lng + dLng),
    joins,
    expiresAt: Date.now() + ttlMs,
  });
  return [
    mk( 0.010,  0.012, 0,  3, -1, 12, 14 * h),   // Morning Yoga
    mk(-0.008,  0.006, 1,  9,  2, 47, 6 * h),    // Evening Cricket Match
    mk( 0.004, -0.011, 6, 73,  8,  8, 2 * 24 * h), // Community Cleanup Drive
    mk(-0.013, -0.007, -1, 30, 0,  3, 20 * h),   // Coffee Meetup
    mk( 0.016, -0.003, 5, 55, 18, 0, 4 * 24 * h), // Weekend Photography Walkathon
    mk(-0.002,  0.017, 4, 82, -1, 21, 30 * h),   // Night Gaming
  ];
}
