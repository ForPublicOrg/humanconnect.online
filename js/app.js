// ============================================================================
// HumanConnect — map UI, event markers, create & detail sheets.
// ============================================================================

import {
  KIND_EVENT, KIND_HELP, taxonomy,
  sentence, itemEmoji, itemColor, isValidCombo, isRetiredWord,
} from './words.js?v=msmfhh75';
import {
  DURATIONS, START_PRESETS, DEFAULT_VIEW, CREATE_COOLDOWN_MS, REPORT_EMAIL, kindCopy,
} from './config.js?v=msmfhh75';
import { createStore } from './store.js?v=msmfhh75';
import { buildMap, pinDiameter } from './map-engine.js?v=msmfhh75';
import { cellsForBounds, cellsForView } from './geo.js?v=msmfhh75';
import { toggleTheme, onThemeChange, effectiveTheme } from './theme.js?v=msmfhh75';
import { initSearch, reverseGeocode } from './search.js?v=msmfhh75';
import { warmTurnstile } from './turnstile.js?v=msmfhh75';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// ---------------------------------------------------------------------------
// Tiny persistent state (per-browser)
// ---------------------------------------------------------------------------
const lsGet = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; }
  catch { return fallback; }
};
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const joined = new Set(lsGet('hc-joined', []));

// Events this browser created, as id -> owner secret. The secret is issued
// once by /api/create and is the only thing that can remove the event early;
// it lives here and nowhere else (its hash is all the server keeps).
const owned = new Map(Object.entries(lsGet('hc-owned', {})));
const saveOwned = () => lsSet('hc-owned', Object.fromEntries(owned));
{
  // Migration from the pre-API shape: `hc-mine` was a plain array of ids,
  // owned via anonymous-auth uid. Those events are still "mine" for labelling
  // but have no secret, so Remove stays hidden — they expire within a week.
  const legacy = lsGet('hc-mine', null);
  if (Array.isArray(legacy)) {
    legacy.forEach((id) => { if (!owned.has(id)) owned.set(id, null); });
    saveOwned();
    try { localStorage.removeItem('hc-mine'); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------
const savedView = lsGet('hc-view', null);
const seedCenter = savedView ?? DEFAULT_VIEW;

// Start the data layer FIRST so its network setup (Firestore SDK import + the
// first snapshot) runs in parallel with loading the map tiles, instead of
// waiting behind them. Events that arrive before the map is ready are buffered
// and flushed once renderEvents is wired up.
let bufferedEvents = null;
let deliver = (list) => { bufferedEvents = list; };
const storeP = createStore({
  onEvents: (list) => deliver(list),
  seedCenter,
  // Estimated from the saved view + window size so the very first Firestore
  // listen is already viewport-scoped — Leaflet hasn't loaded yet. Corrected
  // by updateArea() once the real map settles.
  initialCells: cellsForView(seedCenter, innerWidth, innerHeight),
});

const { map, clusters } = await buildMap('map', seedCenter);

// Marker layer: cluster group at scale, bare map as fallback.
const markerLayer = clusters ?? map;

L.control.zoom({ position: 'bottomleft' }).addTo(map);

const search = initSearch({ map });

// Tell the store which geohash cells the viewport covers (debounced) so we
// only subscribe to nearby events; null = nationwide fallback.
let areaTimer = null;
let subscribedGlobal = false;
function updateArea() {
  const b = map.getBounds();
  // Hysteresis: once we've fallen back to the nationwide query, require the
  // viewport to fit comfortably under the cap before switching back to scoped,
  // so panning/zooming around the boundary doesn't thrash the subscription.
  const cap = subscribedGlobal ? 18 : 25;
  const cells = cellsForBounds(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), cap);
  subscribedGlobal = !cells;
  store.setArea(cells);
}

map.on('moveend', () => {
  const c = map.getCenter();
  lsSet('hc-view', { lat: c.lat, lng: c.lng, zoom: map.getZoom() });
  clearTimeout(areaTimer);
  areaTimer = setTimeout(updateArea, 350);
});

// If the user has no saved view, try a quick one-shot geolocate.
if (!savedView && 'geolocation' in navigator) {
  navigator.geolocation.getCurrentPosition(
    (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 14),
    () => {},
    { timeout: 4000, maximumAge: 600e3 },
  );
}

// ---------------------------------------------------------------------------
// Write errors, in English
//
// Every failure from /api/* carries a machine code; turn it into something a
// person can act on. "Could not create the event" is useless when the real
// answer is "your ad blocker ate the human check" or "wait 90 seconds".
// ---------------------------------------------------------------------------
function fmtWait(ms) {
  const s = Math.ceil(ms / 1000);
  if (s <= 90) return `${s}s`;
  const m = Math.ceil(s / 60);
  return m <= 90 ? `${m} min` : `${Math.ceil(m / 60)}h`;
}

// `copy` is the kind's language (js/config.js) — a couple of these sentences
// name the thing that failed, and a help request is not an event.
function writeError(err, fallback, copy = kindCopy(KIND_EVENT)) {
  switch (err?.code) {
    case 'offline':
      return "You're offline — try again when you're back.";
    case 'verification_unavailable':
      return 'The human check could not load — an ad blocker or privacy mode may be blocking it.';
    case 'verification_timeout':
      return 'The human check timed out — please try again.';
    case 'verification_failed':
    case 'verification_stale':
      return "Couldn't confirm you're human — please try again.";
    case 'rate_limited':
      return err.retryAfterMs
        ? `${err.message} Try again in ${fmtWait(err.retryAfterMs)}.`
        : err.message;
    case 'network_cap':
      return copy.networkCap;
    case 'kind_mismatch':
      // Only reachable if a stale tab holds an id that has since become
      // something else — nothing the user can fix by trying again.
      return 'That pin is not what this sheet thinks it is — reload and try again.';
    case 'bad_start':
      // The sheet clamps to the same rule, so this only surfaces when a draft
      // sat open long enough to drift — say what to do about it.
      return `That time is after the ${copy.noun} leaves the map — pick a sooner time, or a longer stay.`;
    case 'bad_duration':
      // Only reachable from an edit: the stay is measured from placement, and
      // the sheet sat open long enough for the picked one to fully elapse.
      return `The ${copy.noun} has already been up longer than that — pick a longer stay.`;
    case 'verification_unconfigured':
    case 'server_unconfigured':
      return 'Not switched on yet — check back soon.';
    default:
      return fallback;
  }
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
function toast(msg, ms = 2600) {
  const t = el('div', 'toast', msg);
  $('#toasts').appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

// ---------------------------------------------------------------------------
// Markers — size grows with joins
// ---------------------------------------------------------------------------
const markers = new Map(); // id -> { marker, ev } — ev is the copy last painted
let rawEvents = new Map(); // id -> event exactly as the store sent it
let events = new Map();    // id -> event as SHOWN (raw + this browser's pending join)

// ---------------------------------------------------------------------------
// Optimistic join counts
//
// A join is a round trip — the human check, then /api/join, then the snapshot
// that carries the new number back. Holding the count still for all three
// makes a successful tap look like it did nothing, so the +1 goes on screen
// immediately and the live data takes over from there.
//
// `floor` is the snapshot value at which the real increment has landed, so the
// overlay retires itself instead of counting the same join twice. A write that
// fails takes its overlay with it and the number drops back.
// ---------------------------------------------------------------------------
const pendingJoins = new Map(); // id -> { delta, floor }

const withPending = (ev) => {
  const p = ev && pendingJoins.get(ev.id);
  return p ? { ...ev, joins: ev.joins + p.delta } : ev;
};

function addPendingJoin(id) {
  const known = rawEvents.get(id) ?? (detailCache?.id === id ? detailCache : null);
  pendingJoins.set(id, { delta: 1, floor: (known?.joins ?? 0) + 1 });
  paintEvents();
}

function dropPendingJoin(id) {
  if (pendingJoins.delete(id)) paintEvents();
}

// The server's own count, once it answers — a stranger joining at the same
// moment shouldn't keep our overlay alive past the snapshot that includes us.
function confirmPendingJoin(id, joins) {
  const p = pendingJoins.get(id);
  if (p && typeof joins === 'number') p.floor = joins;
}

// A help request wears the same pin with a different silhouette: a rounded
// callout instead of a circle, in the one shared help colour. Shape carries it
// rather than colour, because nine activity categories already own the palette
// — see the note above NEEDS in js/words.js.
function pinHtml(ev) {
  const d = pinDiameter(ev.joins);
  const ring = itemColor(ev.k, ev.b);
  const count = ev.joins > 0 ? `<b class="n">${ev.joins}</b>` : '';
  const help = ev.k === KIND_HELP ? ' help' : '';
  return `<div class="hc-pin${help}" style="--d:${d}px;--ring:${ring}"><span class="e">${itemEmoji(ev.k, ev.b)}</span>${count}</div>`;
}

const pinIcon = (ev) => L.divIcon({ className: 'hc-marker', html: pinHtml(ev), iconSize: [0, 0] });

// divIcon ignores the `alt` option, so label the element ourselves — and again
// whenever the icon is rebuilt, since setIcon() throws the old element away.
function labelMarker(marker, ev) {
  const node = marker.getElement();
  if (!node) return;
  node.setAttribute('role', 'button');
  const what = ev.k === KIND_HELP ? 'help request' : 'event';
  node.setAttribute('aria-label', `${sentence(ev.k, ev.a, ev.b, ev.c)} — ${what}, view details`);
}

function makeMarker(ev) {
  const marker = L.marker([ev.lat, ev.lng], {
    icon: pinIcon(ev),
    riseOnHover: true,
    zIndexOffset: ev.joins,
    keyboard: true,
  });
  marker.on('click', () => openDetail(ev.id));
  // Labelled from the CURRENT copy, not the one this closure captured: a
  // clustered pin is re-added to the map every time its cluster expands,
  // which can be long after an edit changed the words.
  marker.on('add', () => labelMarker(marker, markers.get(ev.id)?.ev ?? ev));
  return marker;
}

// Repaint a pin in place. A join grows it smoothly; an edit changes the words,
// and since the emoji and ring colour are baked into the icon's HTML that case
// rebuilds the icon instead of poking at its pieces.
function updateMarker(entry, ev) {
  const was = entry.ev;
  entry.marker.setZIndexOffset(ev.joins);
  if (was.lat !== ev.lat || was.lng !== ev.lng) entry.marker.setLatLng([ev.lat, ev.lng]);

  const root = entry.marker.getElement();
  const pin = root?.querySelector('.hc-pin');
  const reworded = was.a !== ev.a || was.b !== ev.b || was.c !== ev.c || was.k !== ev.k;
  if (!pin || reworded) {
    entry.marker.setIcon(pinIcon(ev));
    labelMarker(entry.marker, ev);
    return;
  }
  pin.style.setProperty('--d', pinDiameter(ev.joins) + 'px');
  let n = pin.querySelector('.n');
  if (ev.joins > 0) {
    if (!n) { n = el('b', 'n'); pin.appendChild(n); }
    n.textContent = ev.joins;
    n.classList.remove('bump');
    void n.offsetWidth; // restart the bump animation
    n.classList.add('bump');
  } else if (n) {
    n.remove();
  }
}

function renderEvents(list) {
  rawEvents = new Map(list.map((ev) => [ev.id, ev]));
  paintEvents();
}

// Everything a pin shows: the kind picks its shape, the words its emoji and
// ring colour, the count its size, the coordinates where it sits. The diff
// below used to compare only the count, which is why an edited event kept its
// old face until a reload.
const pinSig = (ev) => `${ev.k}|${ev.a}|${ev.b}|${ev.c}|${ev.joins}|${ev.lat}|${ev.lng}`;

/**
 * Fold a write this browser just made into the local copy, so the change is on
 * screen at once instead of after the snapshot round trip. The server has
 * already committed it — the snapshot that follows carries the same values, so
 * whichever lands first, the two agree.
 */
function patchEventLocally(id, patch) {
  const cur = rawEvents.get(id) ?? (detailCache?.id === id ? detailCache : null);
  if (!cur) return;
  const next = { ...cur, ...patch };
  if (rawEvents.has(id)) rawEvents.set(id, next);
  if (detailCache?.id === id) detailCache = next;
  paintEvents();
}

// What's in view, counted honestly. Help requests are not events, so they get
// their own half of the sentence rather than being folded into a total that
// would quietly misdescribe them.
function liveCountText(list) {
  const help = list.reduce((n, ev) => n + (ev.k === KIND_HELP ? 1 : 0), 0);
  const plans = list.length - help;
  const asking = help === 1 ? '1 asking for help' : `${help} asking for help`;
  if (!list.length) return 'Nothing here yet';
  if (!help) return plans === 1 ? '1 live event' : `${plans} live events`;
  if (!plans) return asking;
  return `${plans} ${plans === 1 ? 'event' : 'events'} · ${asking}`;
}

function paintEvents() {
  events = new Map();
  for (const [id, ev] of rawEvents) {
    // Retire an overlay the moment the server's own number reaches it, so the
    // +1 is never added on top of the increment it was standing in for.
    const p = pendingJoins.get(id);
    if (p && ev.joins >= p.floor) pendingJoins.delete(id);
    events.set(id, withPending(ev));
  }
  const list = [...events.values()];

  // Diff, then apply add/remove in BULK — markercluster does cluster-tree and
  // icon work per call, so hundreds of single-layer calls freeze the main
  // thread. addLayers/removeLayers batch the refresh into one pass.
  const toRemove = [];
  const toAdd = [];
  for (const [id, entry] of markers) {
    if (!events.has(id)) { toRemove.push(entry.marker); markers.delete(id); }
  }
  for (const ev of list) {
    const entry = markers.get(ev.id);
    if (!entry) {
      const marker = makeMarker(ev);
      toAdd.push(marker);
      markers.set(ev.id, { marker, ev });
    } else if (pinSig(entry.ev) !== pinSig(ev)) {
      updateMarker(entry, ev);
      entry.ev = ev;
    }
  }
  if (clusters) {
    if (toRemove.length) clusters.removeLayers(toRemove);
    if (toAdd.length) clusters.addLayers(toAdd);
  } else {
    toRemove.forEach((m) => map.removeLayer(m));
    toAdd.forEach((m) => map.addLayer(m));
  }

  $('#empty-note').hidden = list.length > 0;
  $('#live-count').textContent = liveCountText(list);

  // detailCache holds the RAW event; the overlay is applied at fill time so a
  // cached copy can't drift into showing the same pending join twice.
  if (detailId && rawEvents.has(detailId)) {
    detailCache = rawEvents.get(detailId);
    fillDetail(withPending(detailCache));
  } else if (detailId) {
    // Missing from the current subscription. In DEMO mode the list is always
    // the complete dataset (no viewport scoping), so absence is authoritative
    // — the event was removed. In live mode, only call it "ended" if its
    // clock actually ran out — otherwise the user just panned away from a
    // viewport-scoped area and we keep showing the cached details.
    if (store.mode === 'demo' || !detailCache || detailCache.expiresAt <= Date.now()) {
      hideSheet($('#detail-sheet'));
      toast(kindCopy(detailCache?.k).gone);
      detailId = null;
      detailCache = null;
    } else {
      // Panned away, sheet still open — the cached copy is all we have, but a
      // join made from it must still show up in the count.
      fillDetail(withPending(detailCache));
    }
  }

  handleHashOnce();
}

// Purge markers whose time passes while the tab is open.
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, ev] of rawEvents) {
    if (ev.expiresAt <= now) { rawEvents.delete(id); pendingJoins.delete(id); changed = true; }
  }
  if (changed) paintEvents();
}, 30e3);

// ---------------------------------------------------------------------------
// Deep links: humanconnect.online/#e=<id>
// ---------------------------------------------------------------------------
let hashHandled = false;
window.addEventListener('hashchange', () => {
  hashHandled = false;
  handleHashOnce();
});
function handleHashOnce() {
  if (hashHandled) return;
  // #e=<id> or #e=<id>@<lat>,<lng> — coords let us pan there instantly.
  const m = location.hash.match(/^#e=([\w-]+)(?:@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?))?/);
  if (!m) { hashHandled = true; return; }
  hashHandled = true;
  resolveDeepLink(m[1], m[2] != null ? { lat: +m[2], lng: +m[3] } : null);
}

async function resolveDeepLink(id, coords) {
  // Pan toward the shared spot right away if the link carried coordinates.
  if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)) {
    map.setView([coords.lat, coords.lng], Math.max(map.getZoom(), 15));
  }
  // A shared event is usually OUTSIDE the recipient's viewport-scoped
  // subscription, so don't conclude "ended" from the live list alone —
  // fetch the single doc by id before giving up.
  const s = await storeP;
  const ev = rawEvents.get(id) ?? (await s.get?.(id));
  if (ev && ev.expiresAt > Date.now()) {
    map.setView([ev.lat, ev.lng], Math.max(map.getZoom(), 15));
    openDetail(id, ev);
  } else {
    // Nothing was fetched, so there is no kind to name it by — and it may have
    // been removed rather than expired. One sentence that is true either way.
    toast("That's no longer on the map");
    history.replaceState(null, '', location.pathname + location.search);
  }
}

// ---------------------------------------------------------------------------
// Sheets (bottom cards)
// ---------------------------------------------------------------------------
let sheetInvoker = null; // element to return focus to when a sheet closes

function hideSheet(sheet) {
  // Move focus OUT before hiding, or Chrome logs "Blocked aria-hidden on an
  // element because its descendant retained focus". `inert` also blocks Tab
  // from re-entering the closed sheet.
  if (sheet.contains(document.activeElement)) {
    const back = sheetInvoker && document.body.contains(sheetInvoker) ? sheetInvoker : null;
    (back ?? document.body).focus?.();
  }
  sheet.classList.remove('open');
  sheet.inert = true;
  sheet.setAttribute('aria-hidden', 'true');
  // Every route out of the detail sheet funnels through here, so this is the
  // one place its per-event listener has to be let go.
  if (sheet.id === 'detail-sheet') setDetailWatch(null);
}

// User-initiated close (X button, Escape, tapping the map): drop everything.
function dismissSheets() {
  document.querySelectorAll('.sheet.open').forEach(hideSheet);
  removeDraftPin();
  detailId = null;
  editing = null;
}

// Programmatic open: close only the *other* sheet, keep this one's state.
function openSheet(sheet) {
  if (!sheet.classList.contains('open')) sheetInvoker = document.activeElement;
  document.querySelectorAll('.sheet.open').forEach((s) => { if (s !== sheet) hideSheet(s); });
  if (sheet.id === 'detail-sheet') { removeDraftPin(); editing = null; } // details cancel a draft/edit
  if (sheet.id === 'create-sheet') detailId = null;
  sheet.inert = false;
  sheet.classList.add('open');
  sheet.removeAttribute('aria-hidden');
  // Pull focus into the dialog so keyboard/screen-reader users land inside it.
  sheet.focus?.();
}

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => dismissSheets());
});

// ---------------------------------------------------------------------------
// Create flow
// ---------------------------------------------------------------------------
// startAtMs is the absolute time the creator picked (null = "right now", the
// default). startPreset remembers WHICH chip produced it, so the right one
// stays lit while the clock moves underneath.
const draft = {
  kind: KIND_EVENT,
  a: -1, b: -1, c: -1,
  durationMs: DURATIONS[1].ms,
  startAtMs: null, startPreset: null,
  latlng: null,
};
let draftPin = null;

// Non-null while the create sheet is EDITING an existing event instead of
// composing a new one: { id, createdAt }. The 7-day ceiling stays anchored at
// createdAt — editing never restarts the clock (see api/update.js).
let editing = null;
// Only a start time the user actually touched is sent on save; untouched, the
// server keeps what's there (an offset-from-now can't express a past start).
let startTouched = false;

function removeDraftPin() {
  if (draftPin) { draftPin.remove(); draftPin = null; }
}

function startCreate(latlng) {
  editing = null;
  startTouched = false;
  draft.kind = KIND_EVENT;
  draft.a = -1; draft.b = -1; draft.c = -1;
  draft.durationMs = DURATIONS[1].ms;
  draft.startAtMs = null; draft.startPreset = null;
  startNotice = '';
  draft.latlng = latlng;

  removeDraftPin();
  draftPin = L.marker(latlng, {
    draggable: true,
    zIndexOffset: 10000,
    icon: L.divIcon({
      className: 'hc-marker',
      html: '<div class="hc-draft-pin" aria-hidden="true">📍</div>',
      iconSize: [0, 0],
    }),
  }).addTo(map);
  draftPin.on('dragend', () => { draft.latlng = draftPin.getLatLng().wrap(); });

  buildCreateSheet();
  openSheet($('#create-sheet'));
  panDraftAboveSheet(latlng);
  dismissOnboarding();
  // Fetch and render Turnstile while the user is still picking words, so the
  // human check is already warm by the time they hit the button.
  warmTurnstile('create');
}

// Reuse the create sheet to edit an event this browser owns. Words, stay and
// start time are editable; the pin is not — the place is the event, and
// moving it under people who already joined would make it a lie. No Turnstile
// warm-up: /api/update takes the owner secret as proof, like remove.
function startEdit(ev) {
  editing = { id: ev.id, createdAt: ev.createdAt };
  startTouched = false;
  startNotice = '';
  // Not editable, and the switch is hidden while editing: the indices below
  // only mean anything against this kind's word lists, and /api/update refuses
  // a mismatch anyway.
  draft.kind = ev.k;
  draft.a = ev.a; draft.b = ev.b; draft.c = ev.c;
  draft.latlng = null;
  // The stored stay is created→expiry; snap it to the chip that produced it
  // (the server's creation stamp lands a breath after the clock reading that
  // set the expiry, so exact equality would miss every time).
  const stay = ev.expiresAt - ev.createdAt;
  draft.durationMs = DURATIONS.reduce((best, d) =>
    Math.abs(d.ms - stay) < Math.abs(best - stay) ? d.ms : best, DURATIONS[0].ms);
  // A start already behind us shows as "Right now" unselected-ness; saving
  // without touching the row keeps it (see startTouched above).
  draft.startAtMs = ev.startAt != null && ev.startAt > Date.now() ? ev.startAt : null;
  draft.startPreset = null;
  removeDraftPin();
  buildCreateSheet();
  openSheet($('#create-sheet'));
}

// Slide the map so the draft pin sits in the visible strip ABOVE the bottom
// sheet — otherwise the location the user is committing to is hidden behind it.
function panDraftAboveSheet(latlng) {
  const sheetH = $('#create-sheet').getBoundingClientRect().height || 0;
  const visibleH = Math.max(map.getSize().y - sheetH, 120);
  const targetY = visibleH * 0.42;
  const dy = map.latLngToContainerPoint(latlng).y - targetY;
  if (Math.abs(dy) > 10) map.panBy([0, dy], { animate: true, duration: 0.3 });
}

// Everything in the sheet that the kind decides: which word lists the three
// chip rows draw from, what the labels call them, and what the button says.
// Re-run whenever the kind changes, which is why nothing here is wired once.
function buildCreateSheet() {
  const copy = kindCopy(draft.kind);

  // The switch itself. Hidden while editing — a plan cannot become a request
  // (api/update.js refuses it), so offering the choice would be a lie.
  $('#kind-switch').hidden = !!editing;
  $('#kind-event').setAttribute('aria-pressed', String(draft.kind === KIND_EVENT));
  $('#kind-help').setAttribute('aria-pressed', String(draft.kind === KIND_HELP));
  $('#create-help-note').hidden = draft.kind !== KIND_HELP;
  $('#create-sheet').setAttribute('aria-label', editing ? `Edit this ${copy.noun}` : copy.sheetLabel);

  $('#label-main').textContent = copy.labelMain;
  $('#opt-main').textContent = copy.optMain;
  $('#label-first').textContent = copy.labelFirst;
  $('#opt-first').textContent = copy.optFirst;
  $('#label-last').textContent = copy.labelLast;
  $('#opt-last').textContent = copy.optLast;
  $('#label-start').textContent = copy.labelStart;
  $('#opt-start').textContent = copy.optStart;
  $('#activity-search').placeholder = copy.searchPlaceholder;
  $('#create-btn').textContent = editing ? 'Save changes' : copy.cta;

  const t = taxonomy(draft.kind);
  renderChipRow($('#vibe-chips'), t.first, () => draft.a, (i) => { draft.a = draft.a === i ? -1 : i; refreshCreate(); });
  renderActivityGrid('');
  renderChipRow($('#format-chips'), t.last, () => draft.c, (i) => { draft.c = draft.c === i ? -1 : i; refreshCreate(); });
  renderDurations();
  renderStarts();
  $('#activity-search').value = '';
  refreshCreate();
}

// Switching kind throws the word choices away rather than carrying the
// indices across: index 5 is 'Weekend' in one list and 'Tomorrow' in the
// other, so keeping them would silently rename what the user had composed.
function setKind(kind) {
  if (editing || draft.kind === kind) return;
  draft.kind = kind;
  draft.a = -1; draft.b = -1; draft.c = -1;
  // The time itself carries over — when you need help is still when you need
  // it — but a notice explaining a tap in the other mode does not.
  startNotice = '';
  buildCreateSheet();
  if (kind === KIND_HELP) $('#create-help-note').scrollIntoView({ block: 'nearest' });
}

$('#kind-event').addEventListener('click', () => setKind(KIND_EVENT));
$('#kind-help').addEventListener('click', () => setKind(KIND_HELP));

function renderChipRow(container, words, getSel, onTap) {
  container.replaceChildren();
  words.forEach((w, i) => {
    const chip = el('button', 'chip', w.replace(/-/g, ' '));
    chip.type = 'button';
    if (getSel() === i) chip.classList.add('sel');
    chip.addEventListener('click', () => onTap(i));
    container.appendChild(chip);
  });
}

function renderActivityGrid(filter) {
  const box = $('#activity-chips');
  box.replaceChildren();
  const f = filter.trim().toLowerCase();
  taxonomy(draft.kind).main.forEach((act, i) => {
    // Retired words aren't offered — where a typed variant exists, the type
    // is required (api/_lib/validate.js refuses these on create). The one
    // exception: while EDITING a pin that already wears the word, its chip
    // stays visible so the current selection isn't an invisible mystery.
    if (act.r && draft.b !== i) return;
    // Match the stored spelling and the rendered one, so "table tennis" and
    // "o positive" both find their hyphenated words.
    const w = act.w.toLowerCase();
    if (f && !w.includes(f) && !w.replace(/-/g, ' ').includes(f)) return;
    const chip = el('button', 'chip act');
    chip.type = 'button';
    chip.append(el('span', 'em', act.e), document.createTextNode(' ' + act.w.replace(/-/g, ' ')));
    if (draft.b === i) chip.classList.add('sel');
    chip.style.setProperty('--ring', itemColor(draft.kind, i));
    chip.addEventListener('click', () => { draft.b = draft.b === i ? -1 : i; refreshCreate(); });
    box.appendChild(chip);
  });
  if (!box.children.length) box.appendChild(el('p', 'no-match', kindCopy(draft.kind).noMatch));
}

$('#activity-search').addEventListener('input', (e) => renderActivityGrid(e.target.value));

function renderDurations() {
  const row = $('#duration-chips');
  row.replaceChildren();
  DURATIONS.forEach((d) => {
    // Editing: the chips still mean TOTAL time on the map, measured from when
    // the event was first placed — options the event has already outlived
    // would expire it on the spot, so they aren't offered.
    if (editing && editing.createdAt + d.ms <= Date.now()) return;
    const chip = el('button', 'chip', d.label);
    chip.type = 'button';
    if (draft.durationMs === d.ms) chip.classList.add('sel');
    chip.addEventListener('click', () => {
      draft.durationMs = d.ms;
      // Shortening the stay can strand a start time outside it. Clear it and
      // say so rather than quietly sliding the plan to a time nobody chose.
      // The notice explains *this* tap, so it never outlives it.
      startNotice = '';
      if (draft.startAtMs != null && draft.startAtMs > startLimit()) {
        startNotice = kindCopy(draft.kind).startCleared(d.label);
        draft.startAtMs = null;
        draft.startPreset = null;
      }
      renderDurations();
      renderStarts();
    });
    row.appendChild(chip);
  });
}

// ---------------------------------------------------------------------------
// Start time
//
// Optional — most plans begin the moment they go up — and bounded by the
// duration: an event may not start after it has already left the map. The
// chips shrink with the duration so the rule is visible rather than an error
// you hit; the native picker covers everything they don't.
// ---------------------------------------------------------------------------
let startNotice = ''; // one-shot explanation of a time we changed for them

// The last moment the event will exist: for a new event the stay runs from
// now; for an edit it runs from when the event was first placed.
const startLimit = () => (editing ? editing.createdAt : Date.now()) + draft.durationMs;

// <input type="datetime-local"> speaks local wall-clock with no zone, so shift
// the epoch by the offset before slicing an ISO string out of it.
const toLocalInput = (ms) =>
  new Date(ms - new Date(ms).getTimezoneOffset() * 60e3).toISOString().slice(0, 16);

function setStart(atMs, preset = null) {
  startTouched = true;
  draft.startAtMs = atMs;
  draft.startPreset = preset;
  renderStarts();
}

function renderStarts() {
  const row = $('#start-chips');
  const input = $('#start-at');
  const note = $('#start-note');
  const custom = draft.startAtMs != null && draft.startPreset == null;

  row.replaceChildren();
  const chip = (label, sel, onTap) => {
    const b = el('button', 'chip', label);
    b.type = 'button';
    if (sel) b.classList.add('sel');
    b.addEventListener('click', onTap);
    row.appendChild(b);
  };

  chip('Right now', draft.startAtMs == null, () => { startNotice = ''; setStart(null); });
  for (const p of START_PRESETS) {
    // Presets are offsets from NOW; while editing, the window they must land
    // inside is measured from the original placement, so compare absolutes.
    if (Date.now() + p.ms > startLimit()) continue;
    chip(p.label, draft.startPreset === p.ms, () => {
      startNotice = '';
      setStart(Date.now() + p.ms, p.ms);
    });
  }
  chip('Pick a time…', custom, openStartPicker);

  input.hidden = !custom;
  input.min = toLocalInput(Date.now());
  input.max = toLocalInput(startLimit());
  if (custom) input.value = toLocalInput(draft.startAtMs);

  // The same sentence the detail sheet will show, so what you set is what you
  // (and everyone else) will read back — "Starts 6:30 pm" for a plan, "Needed
  // 6:30 pm" for a request.
  const said = [];
  if (draft.startAtMs != null) said.push(`${kindCopy(draft.kind).starts(fmtClock(draft.startAtMs))}.`);
  if (startNotice) said.push(startNotice);
  note.textContent = said.join(' ');
  note.hidden = !said.length;
  note.classList.toggle('warn', !!startNotice);
}

function openStartPicker() {
  startNotice = '';
  // Seed the field with the next round half-hour — how people actually name a
  // meeting time — without ever offering one past the event's last moment.
  const seed = draft.startAtMs
    ?? Math.min(Math.ceil((Date.now() + 60e3) / 1800e3) * 1800e3, startLimit());
  setStart(seed, null);
  const input = $('#start-at');
  input.focus();
  // Not every browser has it, and it throws where it isn't allowed — the field
  // is still typeable either way.
  try { input.showPicker?.(); } catch { /* the field itself is the fallback */ }
}

$('#start-at').addEventListener('change', (e) => {
  const raw = e.target.value;
  if (!raw) { startNotice = ''; setStart(null); return; }
  const picked = new Date(raw).getTime(); // no zone in the string ⇒ local time
  if (!Number.isFinite(picked)) { startNotice = ''; setStart(null); return; }

  const copy = kindCopy(draft.kind);
  const limit = startLimit();
  if (picked > limit) {
    startNotice = copy.startClamped;
    setStart(limit, null);
  } else if (picked <= Date.now()) {
    // The field only has minute resolution, so picking the current minute is a
    // request to start now, not a mistake worth explaining.
    startNotice = Date.now() - picked >= 60e3 ? copy.startPassed : '';
    setStart(null);
  } else {
    startNotice = '';
    setStart(picked, null);
  }
});

function refreshCreate() {
  const t = taxonomy(draft.kind);
  const copy = kindCopy(draft.kind);

  // Re-render selections
  renderChipRow($('#vibe-chips'), t.first, () => draft.a, (i) => { draft.a = draft.a === i ? -1 : i; refreshCreate(); });
  renderActivityGrid($('#activity-search').value);
  renderChipRow($('#format-chips'), t.last, () => draft.c, (i) => { draft.c = draft.c === i ? -1 : i; refreshCreate(); });

  const preview = $('#create-preview');
  const hint = $('#create-hint');
  const btn = $('#create-btn');

  if (draft.b === -1) {
    preview.textContent = copy.previewEmpty;
    preview.classList.add('empty');
    hint.textContent = copy.hintPick;
    btn.disabled = true;
    return;
  }
  const valid = isValidCombo(draft.kind, draft.a, draft.b, draft.c);
  preview.textContent = sentence(draft.kind, draft.a, draft.b, draft.c);
  preview.classList.remove('empty');
  hint.textContent = valid ? copy.hintOk : copy.hintMore;
  btn.disabled = !valid;
}

// Save an edit: same sheet, different write. No client cooldown — it's their
// own event, and /api/update has its own limiter.
async function saveEdit() {
  const { id, createdAt } = editing;
  const copy = kindCopy(draft.kind);
  if (!isValidCombo(draft.kind, draft.a, draft.b, draft.c)) return;
  const btn = $('#create-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const out = await store.update({
      id, secret: owned.get(id),
      // Not a change — the server validates the words against it and refuses
      // anything but the kind already stored.
      k: draft.kind,
      a: draft.a, b: draft.b, c: draft.c,
      durationMs: draft.durationMs,
      // Only when the user touched the start row — omitted, the server keeps
      // the time already set. Clamped like create: the sheet may have sat
      // open long enough for the chosen moment to drift past.
      ...(startTouched ? {
        startInMs: draft.startAtMs == null
          ? null
          : Math.min(Math.max(0, draft.startAtMs - Date.now()),
                     Math.max(0, createdAt + draft.durationMs - Date.now())),
      } : {}),
    });
    // Put the edit on the map now. Waiting for the snapshot made a successful
    // save look like nothing happened — the sheet closed and the pin still
    // wore its old name until the page was reloaded.
    patchEventLocally(id, {
      a: draft.a, b: draft.b, c: draft.c,
      ...(typeof out?.expiresAt === 'number' ? { expiresAt: out.expiresAt } : {}),
      ...(out && 'startAt' in out ? { startAt: out.startAt } : {}),
    });
    dismissSheets();
    toast(copy.updated);
  } catch (err) {
    console.error('[humanconnect] update failed:', err);
    if (err?.code === 'not-found') { dismissSheets(); toast(copy.gone); return; }
    toast(writeError(err, copy.saveFailed, copy), 4500);
  } finally {
    btn.disabled = false;
    btn.textContent = editing ? 'Save changes' : copy.cta;
  }
}

$('#create-btn').addEventListener('click', async () => {
  if (editing) return saveEdit();
  const last = lsGet('hc-last-create', 0);
  if (Date.now() - last < CREATE_COOLDOWN_MS) {
    const wait = Math.ceil((CREATE_COOLDOWN_MS - (Date.now() - last)) / 1000);
    // One bucket for both kinds, server-side and here — so say it without
    // naming either.
    toast(`Take a breath — you can post again in ${wait}s`);
    return;
  }
  if (!draft.latlng || !isValidCombo(draft.kind, draft.a, draft.b, draft.c)) return;

  const copy = kindCopy(draft.kind);
  const btn = $('#create-btn');
  btn.disabled = true;
  btn.textContent = copy.ctaBusy;
  try {
    const { id, secret } = await store.create({
      k: draft.kind,
      a: draft.a, b: draft.b, c: draft.c,
      lat: draft.latlng.lat, lng: draft.latlng.lng,
      durationMs: draft.durationMs,
      // Sent as an offset from now, not a timestamp: the server owns the clock,
      // so a device running minutes fast still gets the time its owner picked.
      // Clamped because the sheet may have sat open long enough to drift past
      // the chosen moment, or past the window itself.
      startInMs: draft.startAtMs == null
        ? null
        : Math.min(Math.max(0, draft.startAtMs - Date.now()), draft.durationMs),
    });
    owned.set(id, secret ?? null);
    saveOwned();
    lsSet('hc-last-create', Date.now());
    dismissSheets();
    toast(copy.created);
  } catch (err) {
    console.error(err);
    toast(writeError(err, copy.createFailed, copy), 4500);
  } finally {
    btn.disabled = false;
    btn.textContent = copy.cta;
  }
});

// Tap the map → create there. While composing → move the draft to the new
// spot (don't discard the selections). While a detail sheet is open → close it.
// A double-click zooms (standard map gesture), so debounce the single-tap
// action and cancel it when a dblclick follows.
let tapTimer = null;
function handleMapTap(ll) {
  if ($('#create-sheet').classList.contains('open')) {
    if (editing) return; // an edit is tied to its pin — taps don't move it
    draft.latlng = ll;
    draftPin?.setLatLng(ll);
    panDraftAboveSheet(ll);
    return;
  }
  if (document.querySelector('.sheet.open')) { dismissSheets(); return; }
  startCreate(ll);
}
map.on('click', (e) => {
  if (search.tapSwallowed()) return; // this tap only dismissed the search panel
  const t = e.originalEvent?.target;
  if (t?.closest?.('.hc-pin, .hc-draft-pin')) return;
  const ll = e.latlng.wrap();
  clearTimeout(tapTimer);
  tapTimer = setTimeout(() => handleMapTap(ll), 250);
});
map.on('dblclick', () => clearTimeout(tapTimer)); // let Leaflet zoom instead

$('#fab').addEventListener('click', () => startCreate(map.getCenter().wrap()));

// ---------------------------------------------------------------------------
// Detail sheet
// ---------------------------------------------------------------------------
let detailId = null;
let detailCache = null; // last-known copy, survives viewport-scoped unsubscribes
let countdownTimer = null;

// Sharing draws the event and its map onto a canvas — no business on the
// first-paint path, so js/share.js is fetched only once a sheet is open.
const shareModule = () => import('./share.js?v=msmfhh75');

function fmtRemaining(ms) {
  if (ms <= 0) return 'ended';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return `${s % 60}s`;
}

// Wall-clock time, with only as much date as it takes to be unambiguous — a
// plan can be set a week out, so "6:30 pm" alone doesn't always say which day.
// Rendered in the *reader's* zone, which is the right answer: you go to an
// event where you are.
const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const DAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function fmtClock(ms) {
  const d = new Date(ms);
  const time = TIME_FMT.format(d);
  // Calendar days apart, not elapsed hours — 11pm to 1am is "tomorrow". Round,
  // because a DST shift makes a day 23 or 25 hours long.
  const days = Math.round((midnight(d) - midnight(new Date())) / 864e5);
  if (days === 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  if (days === -1) return `yesterday ${time}`;
  return `${DAY_FMT.format(d)} ${time}`;
}

const fmtJoins = (ev) => kindCopy(ev.k).joins(ev.joins);

const fmtEnds = (ev) => kindCopy(ev.k).ends(fmtRemaining(ev.expiresAt - Date.now()));

// Empty for pins with no time set — most of them, and every event created
// before start times existed.
const fmtStarts = (ev) => {
  if (ev.startAt == null) return '';
  const copy = kindCopy(ev.k);
  const when = fmtClock(ev.startAt);
  return ev.startAt <= Date.now() ? copy.started(when) : copy.starts(when);
};

function paintStarts(ev) {
  const node = $('#detail-starts');
  node.textContent = fmtStarts(ev);
  node.hidden = !node.textContent;
}

function fillDetail(ev) {
  if (!ev) return;
  const copy = kindCopy(ev.k);
  const help = ev.k === KIND_HELP;

  const medallion = $('#detail-emoji');
  medallion.textContent = itemEmoji(ev.k, ev.b);
  medallion.style.setProperty('--ring', itemColor(ev.k, ev.b));
  medallion.classList.toggle('help', help);
  $('#detail-kind').hidden = !help;
  $('#detail-help-note').hidden = !help;
  $('#detail-sheet').setAttribute('aria-label', help ? 'Help request details' : 'Event details');
  $('#share-btn').setAttribute('aria-label', `Share this ${copy.noun}`);

  $('#detail-title').textContent = sentence(ev.k, ev.a, ev.b, ev.c);
  $('#detail-joins').textContent = fmtJoins(ev);
  paintStarts(ev);
  $('#detail-ends').textContent = fmtEnds(ev);
  $('#detail-mine').hidden = !owned.has(ev.id);
  $('#detail-mine').textContent = copy.mineTag;
  $('#report-btn').textContent = copy.report;
  $('#edit-btn').textContent = copy.edit;

  // Remove is offered only where it can actually work: pins this browser
  // created AND for which we still hold the owner secret. (Events from before
  // the API existed are labelled "yours" but have no secret — nothing can take
  // those down early.)
  const rm = $('#remove-btn');
  rm.hidden = !owned.get(ev.id);
  delete rm.dataset.arm; // any re-render disarms the confirm
  rm.textContent = copy.remove;
  // Edit additionally needs the placement time — the anchor of the 7-day
  // ceiling — which the snapshot echoes back as createdAt a moment after
  // creating.
  $('#edit-btn').hidden = !owned.get(ev.id) || ev.createdAt == null;

  const btn = $('#join-btn');
  if (joined.has(ev.id)) {
    btn.disabled = true;
    btn.textContent = copy.joined;
  } else {
    btn.disabled = false;
    btn.textContent = copy.join;
  }
}

// Fly to the event's exact spot: close-up zoom (never zoom OUT if the user is
// already closer), with the pin landing in the strip visible above the detail
// sheet rather than hidden behind it.
function flyToEvent(lat, lng) {
  const z = Math.max(map.getZoom(), 15);
  const sheetH = $('#detail-sheet').getBoundingClientRect().height || 0;
  const visibleH = Math.max(map.getSize().y - sheetH, 120);
  const targetY = visibleH * 0.45;
  const dy = map.getSize().y / 2 - targetY; // px the map centre sits below the pin
  const centre = map.unproject(map.project([lat, lng], z).add([0, dy]), z);
  map.flyTo(centre, z, { duration: 0.7 });
}

// Where the pin is, in words — and a free universal Google Maps link so
// people can actually navigate there (opens the app on mobile). The address
// is best-effort reverse geocoding; the link works regardless.
function fillPlace(ev) {
  const a = $('#detail-place');
  a.href = `https://www.google.com/maps?q=${ev.lat.toFixed(6)},${ev.lng.toFixed(6)}`;
  a.textContent = 'Open in Google Maps ↗';
  const id = ev.id;
  reverseGeocode(ev.lat, ev.lng).then((label) => {
    // Only apply if the user is still looking at the same event.
    if (label && detailId === id) a.textContent = `${label} ↗`;
  });
}

// A listener on just the open event — see store.watch(). The map's own
// listener covers a capped, viewport-scoped slice, which is not necessarily
// the event being read; without this, someone else's join (or the creator's
// edit, made on their phone) reached the screen only on a reload.
let detailWatch = null;
function setDetailWatch(id) {
  detailWatch?.();
  detailWatch = null;
  if (!id) return;
  detailWatch = store.watch?.(id, (ev) => {
    if (detailId !== id) return;
    if (!ev) {
      // Removed by its creator, or its clock ran out while being read.
      const gone = kindCopy(detailCache?.k).gone;
      hideSheet($('#detail-sheet'));
      detailId = null;
      detailCache = null;
      toast(gone);
      return;
    }
    patchEventLocally(id, ev);
  }) ?? null;
}

function openDetail(id, fallback) {
  const ev = rawEvents.get(id) ?? fallback;
  if (!ev) return;
  detailId = id;
  detailCache = ev;
  fillDetail(withPending(ev));
  fillPlace(ev);
  openSheet($('#detail-sheet'));
  setDetailWatch(id);
  flyToEvent(ev.lat, ev.lng);
  if (!joined.has(id)) warmTurnstile('join'); // Join is one tap away — get ready
  shareModule().catch(() => {}); // so does Share — fetch it while they read

  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    const cur = events.get(detailId) ?? (detailId ? detailCache : null);
    if (!cur) { clearInterval(countdownTimer); return; }
    $('#detail-ends').textContent = fmtEnds(cur);
    paintStarts(cur); // so "Starts" becomes "Started" the moment it does
  }, 1000);
}

$('#join-btn').addEventListener('click', async () => {
  if (!detailId || joined.has(detailId)) return;
  const id = detailId;
  const copy = kindCopy((rawEvents.get(id) ?? detailCache)?.k);
  const btn = $('#join-btn');
  // Optimistic, on both counts: the button flips so live snapshot re-renders
  // can't push it back mid-write, and the number moves now rather than a round
  // trip later. Everything here is undone if the write doesn't land.
  joined.add(id);
  lsSet('hc-joined', [...joined]);
  btn.disabled = true;
  btn.textContent = copy.joined;
  addPendingJoin(id);
  try {
    const out = await store.join(id);
    // This device was already counted (a second tab, a re-opened link): the
    // stored number never moved, so our +1 has to come back off.
    if (out?.already) dropPendingJoin(id);
    else confirmPendingJoin(id, out?.joins);
  } catch (err) {
    console.error(err);
    joined.delete(id);
    lsSet('hc-joined', [...joined]);
    dropPendingJoin(id);
    // The event was removed by its creator (or expired server-side): stop
    // showing it rather than inviting a retry that can never succeed.
    if (err?.code === 'not-found') {
      if (detailId === id) { dismissSheets(); detailId = null; detailCache = null; }
      toast(copy.gone);
      return;
    }
    // Re-enable from the cached copy — the event may have left the viewport.
    if (detailId === id) fillDetail(withPending(rawEvents.get(id) ?? detailCache));
    toast(writeError(err, copy.joinFailed, copy), 4500);
  }
});

// Share: draw the event and its map into an image, then hand it to the share
// sheet (js/share.js), which owns every route out of the browser.
$('#share-btn').addEventListener('click', async () => {
  if (!detailId) return;
  const ev = events.get(detailId) ?? withPending(detailCache);
  if (!ev) return;
  // Embed coordinates so the recipient — usually browsing another area — pans
  // straight to it even before the event doc is fetched.
  const url = `${location.origin}${location.pathname}#e=${detailId}` +
    `@${ev.lat.toFixed(5)},${ev.lng.toFixed(5)}`;
  const copy = kindCopy(ev.k);
  const title = sentence(ev.k, ev.a, ev.b, ev.c);
  try {
    const { openShare } = await shareModule();
    await openShare(ev, {
      url,
      title,
      // What the share sheet and its image call this thing — a request is not
      // an event, and a shared picture is the copy strangers see first.
      noun: copy.noun,
      text: copy.shareText(title),
      // Read off the screen, not re-derived: the card is a picture of what
      // the user is looking at, down to the button labels.
      joinsText: fmtJoins(ev),
      startsText: $('#detail-starts').textContent,
      endsText: fmtEnds(ev),
      place: $('#detail-place').textContent,
      joinLabel: $('#join-btn').textContent,
      shareLabel: $('#share-btn').textContent,
      liveCount: $('#live-count').textContent,
    }, { openSheet, toast });
  } catch (err) {
    console.error('[humanconnect] share unavailable:', err);
    toast('Sharing is unavailable right now');
  }
});

$('#edit-btn').addEventListener('click', () => {
  if (!detailId) return;
  const ev = rawEvents.get(detailId) ?? detailCache;
  if (ev && ev.createdAt != null && owned.get(ev.id)) startEdit(ev);
});

// Deleting is irreversible, so arm-then-confirm: first tap changes the label,
// second tap within the same view actually removes. Any re-render disarms.
$('#remove-btn').addEventListener('click', async () => {
  if (!detailId) return;
  const copy = kindCopy((rawEvents.get(detailId) ?? detailCache)?.k);
  const rm = $('#remove-btn');
  if (!rm.dataset.arm) {
    rm.dataset.arm = '1';
    rm.textContent = copy.removeArmed;
    return;
  }
  delete rm.dataset.arm;
  rm.textContent = copy.remove;
  const id = detailId;
  const cache = detailCache;
  // Detach from the event BEFORE the write. Removing it re-renders the map
  // synchronously (the demo store emits inline), and a still-set detailId
  // makes that pass think the event vanished from under the user — firing a
  // contradictory "This event is gone" on top of our own "Event removed".
  detailId = null;
  detailCache = null;
  rm.disabled = true;
  try {
    await store.remove(id, owned.get(id));
    owned.delete(id);
    saveOwned();
    // Take the pin off the map now, not whenever the snapshot says so — the
    // sheet has already closed, so a pin still sitting there reads as a
    // removal that failed.
    rawEvents.delete(id);
    pendingJoins.delete(id);
    paintEvents();
    dismissSheets();
    toast(copy.removed);
  } catch (err) {
    console.error('[humanconnect] remove failed:', err);
    detailId = id; // put the user back where they were
    detailCache = cache;
    fillDetail(withPending(rawEvents.get(id) ?? cache));
    toast(writeError(err, copy.removeFailed, copy), 4500);
  } finally {
    rm.disabled = false;
  }
});

$('#report-btn').addEventListener('click', () => {
  if (!detailId) return;
  const ev = events.get(detailId) ?? detailCache;
  const noun = kindCopy(ev?.k).noun;
  const subject = encodeURIComponent(`[HumanConnect] Report ${noun} ${detailId}`);
  const body = encodeURIComponent(
    `${noun === 'request' ? 'Request' : 'Event'}: ${ev ? sentence(ev.k, ev.a, ev.b, ev.c) : detailId}\n` +
    `Location: ${ev?.lat}, ${ev?.lng}\nReason: `,
  );
  location.href = `mailto:${REPORT_EMAIL}?subject=${subject}&body=${body}`;
});

// ---------------------------------------------------------------------------
// Header controls
// ---------------------------------------------------------------------------
let meDot = null;
$('#locate-btn').addEventListener('click', () => {
  if (!('geolocation' in navigator)) { toast('Location is not available'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const ll = [pos.coords.latitude, pos.coords.longitude];
      map.flyTo(ll, Math.max(map.getZoom(), 15), { duration: 0.8 });
      if (meDot) meDot.remove();
      meDot = L.circleMarker(ll, {
        radius: 7, color: '#fff', weight: 2, fillColor: '#276ef1', fillOpacity: 1,
      }).addTo(map);
    },
    () => toast('Could not get your location'),
    { enableHighAccuracy: true, timeout: 8000 },
  );
});

// Theme toggle — button icon swaps via CSS; keep the label in sync for a11y.
const themeBtn = $('#theme-btn');
const syncThemeLabel = (t) => {
  const label = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  themeBtn.setAttribute('aria-label', label);
  themeBtn.setAttribute('title', label);
};
syncThemeLabel(effectiveTheme());
themeBtn.addEventListener('click', toggleTheme);
onThemeChange(syncThemeLabel);

$('#about-btn').addEventListener('click', () => $('#about-modal').showModal());
$('#about-close').addEventListener('click', () => $('#about-modal').close());
$('#about-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

// ---------------------------------------------------------------------------
// Onboarding hint (first visit only)
// ---------------------------------------------------------------------------
function dismissOnboarding() {
  const n = $('#onboard');
  if (n && !n.hidden) { n.hidden = true; lsSet('hc-onboarded', true); }
}
if (!lsGet('hc-onboarded', false)) {
  $('#onboard').hidden = false;
  $('#onboard-close').addEventListener('click', dismissOnboarding);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') dismissSheets();
});

// ---------------------------------------------------------------------------
// Connectivity banner — a silent stale map is worse than an honest one.
// ---------------------------------------------------------------------------
const setOffline = (off) => { $('#offline-banner').hidden = !off; };
window.addEventListener('offline', () => setOffline(true));
window.addEventListener('online', () => setOffline(false));
if (!navigator.onLine) setOffline(true);

// ---------------------------------------------------------------------------
// Wire the store to the UI. createStore() was kicked off before the map so its
// network work overlapped tile loading; here we flush anything it buffered.
// ---------------------------------------------------------------------------
let store = {
  mode: 'demo',
  setArea() {},
  get: async () => null,
  watch: () => () => {},
  create: async () => { throw new Error('store not ready'); },
  join: async () => { throw new Error('store not ready'); },
  update: async () => { throw new Error('store not ready'); },
  remove: async () => { throw new Error('store not ready'); },
};
deliver = renderEvents;
if (bufferedEvents) renderEvents(bufferedEvents);
storeP.then((s) => {
  store = s;
  if (s.mode === 'demo') $('#demo-banner').hidden = false;
  updateArea(); // scope the subscription to the current viewport
});
$('#demo-close')?.addEventListener('click', () => { $('#demo-banner').hidden = true; });
