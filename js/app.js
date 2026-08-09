// ============================================================================
// HumanConnect — map UI, event markers, create & detail sheets.
// ============================================================================

import {
  VIBES, ACTIVITIES, FORMATS,
  sentence, activityEmoji, activityColor, isValidCombo,
} from './words.js?v=msmfhh75';
import {
  DURATIONS, DEFAULT_VIEW, CREATE_COOLDOWN_MS, REPORT_EMAIL,
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

function writeError(err, fallback) {
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
      return 'This connection has already joined this event.';
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
const markers = new Map(); // id -> { marker, joins }
let events = new Map();    // id -> event

function pinHtml(ev) {
  const d = pinDiameter(ev.joins);
  const ring = activityColor(ev.b);
  const count = ev.joins > 0 ? `<b class="n">${ev.joins}</b>` : '';
  return `<div class="hc-pin" style="--d:${d}px;--ring:${ring}"><span class="e">${activityEmoji(ev.b)}</span>${count}</div>`;
}

function makeMarker(ev) {
  const icon = L.divIcon({ className: 'hc-marker', html: pinHtml(ev), iconSize: [0, 0] });
  const marker = L.marker([ev.lat, ev.lng], {
    icon,
    riseOnHover: true,
    zIndexOffset: ev.joins,
    keyboard: true,
  });
  marker.on('click', () => openDetail(ev.id));
  // divIcon ignores the `alt` option, so label the element ourselves.
  marker.on('add', () => {
    const node = marker.getElement();
    if (node) {
      node.setAttribute('role', 'button');
      node.setAttribute('aria-label', `${sentence(ev.a, ev.b, ev.c)} — view details`);
    }
  });
  return marker;
}

// Smoothly grow an existing pin instead of recreating its icon.
function updateMarker(entry, ev) {
  entry.marker.setZIndexOffset(ev.joins);
  const root = entry.marker.getElement();
  const pin = root?.querySelector('.hc-pin');
  if (!pin) { entry.marker.setIcon(L.divIcon({ className: 'hc-marker', html: pinHtml(ev), iconSize: [0, 0] })); return; }
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
  events = new Map(list.map((ev) => [ev.id, ev]));

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
      markers.set(ev.id, { marker, joins: ev.joins });
    } else if (entry.joins !== ev.joins) {
      updateMarker(entry, ev);
      entry.joins = ev.joins;
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
  $('#live-count').textContent =
    list.length === 0 ? 'No events here yet' :
    list.length === 1 ? '1 live event' : `${list.length} live events`;

  if (detailId && events.has(detailId)) {
    detailCache = events.get(detailId);
    fillDetail(detailCache);
  } else if (detailId) {
    // Missing from the current subscription. In DEMO mode the list is always
    // the complete dataset (no viewport scoping), so absence is authoritative
    // — the event was removed. In live mode, only call it "ended" if its
    // clock actually ran out — otherwise the user just panned away from a
    // viewport-scoped area and we keep showing the cached details.
    if (store.mode === 'demo' || !detailCache || detailCache.expiresAt <= Date.now()) {
      hideSheet($('#detail-sheet'));
      toast('This event is gone');
      detailId = null;
      detailCache = null;
    }
  }

  handleHashOnce();
}

// Purge markers whose time passes while the tab is open.
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, ev] of events) {
    if (ev.expiresAt <= now) { events.delete(id); changed = true; }
  }
  if (changed) renderEvents([...events.values()]);
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
  const ev = events.get(id) ?? (await s.get?.(id));
  if (ev && ev.expiresAt > Date.now()) {
    map.setView([ev.lat, ev.lng], Math.max(map.getZoom(), 15));
    openDetail(id, ev);
  } else {
    toast('That event has ended');
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
}

// User-initiated close (X button, Escape, tapping the map): drop everything.
function dismissSheets() {
  document.querySelectorAll('.sheet.open').forEach(hideSheet);
  removeDraftPin();
  detailId = null;
}

// Programmatic open: close only the *other* sheet, keep this one's state.
function openSheet(sheet) {
  if (!sheet.classList.contains('open')) sheetInvoker = document.activeElement;
  document.querySelectorAll('.sheet.open').forEach((s) => { if (s !== sheet) hideSheet(s); });
  if (sheet.id === 'detail-sheet') removeDraftPin(); // opening details cancels a draft
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
const draft = { a: -1, b: -1, c: -1, durationMs: DURATIONS[1].ms, latlng: null };
let draftPin = null;

function removeDraftPin() {
  if (draftPin) { draftPin.remove(); draftPin = null; }
}

function startCreate(latlng) {
  draft.a = -1; draft.b = -1; draft.c = -1;
  draft.durationMs = DURATIONS[1].ms;
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

// Slide the map so the draft pin sits in the visible strip ABOVE the bottom
// sheet — otherwise the location the user is committing to is hidden behind it.
function panDraftAboveSheet(latlng) {
  const sheetH = $('#create-sheet').getBoundingClientRect().height || 0;
  const visibleH = Math.max(map.getSize().y - sheetH, 120);
  const targetY = visibleH * 0.42;
  const dy = map.latLngToContainerPoint(latlng).y - targetY;
  if (Math.abs(dy) > 10) map.panBy([0, dy], { animate: true, duration: 0.3 });
}

function buildCreateSheet() {
  renderChipRow($('#vibe-chips'), VIBES, () => draft.a, (i) => { draft.a = draft.a === i ? -1 : i; refreshCreate(); });
  renderActivityGrid('');
  renderChipRow($('#format-chips'), FORMATS, () => draft.c, (i) => { draft.c = draft.c === i ? -1 : i; refreshCreate(); });
  renderDurations();
  $('#activity-search').value = '';
  refreshCreate();
}

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
  ACTIVITIES.forEach((act, i) => {
    if (f && !act.w.toLowerCase().includes(f)) return;
    const chip = el('button', 'chip act');
    chip.type = 'button';
    chip.append(el('span', 'em', act.e), document.createTextNode(' ' + act.w.replace(/-/g, ' ')));
    if (draft.b === i) chip.classList.add('sel');
    chip.style.setProperty('--ring', activityColor(i));
    chip.addEventListener('click', () => { draft.b = draft.b === i ? -1 : i; refreshCreate(); });
    box.appendChild(chip);
  });
  if (!box.children.length) box.appendChild(el('p', 'no-match', 'No matching activity'));
}

$('#activity-search').addEventListener('input', (e) => renderActivityGrid(e.target.value));

function renderDurations() {
  const row = $('#duration-chips');
  row.replaceChildren();
  DURATIONS.forEach((d) => {
    const chip = el('button', 'chip', d.label);
    chip.type = 'button';
    if (draft.durationMs === d.ms) chip.classList.add('sel');
    chip.addEventListener('click', () => { draft.durationMs = d.ms; renderDurations(); });
    row.appendChild(chip);
  });
}

function refreshCreate() {
  // Re-render selections
  renderChipRow($('#vibe-chips'), VIBES, () => draft.a, (i) => { draft.a = draft.a === i ? -1 : i; refreshCreate(); });
  renderActivityGrid($('#activity-search').value);
  renderChipRow($('#format-chips'), FORMATS, () => draft.c, (i) => { draft.c = draft.c === i ? -1 : i; refreshCreate(); });

  const preview = $('#create-preview');
  const hint = $('#create-hint');
  const btn = $('#create-btn');

  if (draft.b === -1) {
    preview.textContent = 'Pick an activity…';
    preview.classList.add('empty');
    hint.textContent = 'Choose one activity, then add a vibe or a format.';
    btn.disabled = true;
    return;
  }
  const valid = isValidCombo(draft.a, draft.b, draft.c);
  preview.textContent = sentence(draft.a, draft.b, draft.c);
  preview.classList.remove('empty');
  hint.textContent = valid ? 'Looks good — set how long it stays on the map.' : 'Add a vibe or a format to complete the name (2–3 words).';
  btn.disabled = !valid;
}

$('#create-btn').addEventListener('click', async () => {
  const last = lsGet('hc-last-create', 0);
  if (Date.now() - last < CREATE_COOLDOWN_MS) {
    const wait = Math.ceil((CREATE_COOLDOWN_MS - (Date.now() - last)) / 1000);
    toast(`Take a breath — you can create another event in ${wait}s`);
    return;
  }
  if (!draft.latlng || !isValidCombo(draft.a, draft.b, draft.c)) return;

  const btn = $('#create-btn');
  btn.disabled = true;
  btn.textContent = 'Putting it on the map…';
  try {
    const { id, secret } = await store.create({
      a: draft.a, b: draft.b, c: draft.c,
      lat: draft.latlng.lat, lng: draft.latlng.lng,
      durationMs: draft.durationMs,
    });
    owned.set(id, secret ?? null);
    saveOwned();
    lsSet('hc-last-create', Date.now());
    dismissSheets();
    toast('Your event is live 💚');
  } catch (err) {
    console.error(err);
    toast(writeError(err, 'Could not create the event — check your connection'), 4500);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Put it on the map';
  }
});

// Tap the map → create there. While composing → move the draft to the new
// spot (don't discard the selections). While a detail sheet is open → close it.
// A double-click zooms (standard map gesture), so debounce the single-tap
// action and cancel it when a dblclick follows.
let tapTimer = null;
function handleMapTap(ll) {
  if ($('#create-sheet').classList.contains('open')) {
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

const fmtJoins = (joins) =>
  joins === 0 ? 'Be the first to join' :
  joins === 1 ? '1 person joining' : `${joins} people joining`;

const fmtEnds = (ev) => `Ends in ${fmtRemaining(ev.expiresAt - Date.now())}`;

function fillDetail(ev) {
  if (!ev) return;
  $('#detail-emoji').textContent = activityEmoji(ev.b);
  $('#detail-emoji').style.setProperty('--ring', activityColor(ev.b));
  $('#detail-title').textContent = sentence(ev.a, ev.b, ev.c);
  $('#detail-joins').textContent = fmtJoins(ev.joins);
  $('#detail-ends').textContent = fmtEnds(ev);
  $('#detail-mine').hidden = !owned.has(ev.id);

  // Remove is offered only where it can actually work: events this browser
  // created AND for which we still hold the owner secret. (Events from before
  // the API existed are labelled "yours" but have no secret — nothing can take
  // those down early.)
  const rm = $('#remove-btn');
  rm.hidden = !owned.get(ev.id);
  if (rm.dataset.arm) { delete rm.dataset.arm; rm.textContent = 'Remove this event'; }

  const btn = $('#join-btn');
  if (joined.has(ev.id)) {
    btn.disabled = true;
    btn.textContent = "You're in ✓";
  } else {
    btn.disabled = false;
    btn.textContent = 'Join';
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

function openDetail(id, fallback) {
  const ev = events.get(id) ?? fallback;
  if (!ev) return;
  detailId = id;
  detailCache = ev;
  fillDetail(ev);
  fillPlace(ev);
  openSheet($('#detail-sheet'));
  flyToEvent(ev.lat, ev.lng);
  if (!joined.has(id)) warmTurnstile('join'); // Join is one tap away — get ready
  shareModule().catch(() => {}); // so does Share — fetch it while they read

  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    const cur = events.get(detailId) ?? (detailId ? detailCache : null);
    if (!cur) { clearInterval(countdownTimer); return; }
    $('#detail-ends').textContent = `Ends in ${fmtRemaining(cur.expiresAt - Date.now())}`;
  }, 1000);
}

$('#join-btn').addEventListener('click', async () => {
  if (!detailId || joined.has(detailId)) return;
  const id = detailId;
  const btn = $('#join-btn');
  // Optimistic: mark as joined first so live snapshot re-renders can't
  // flip the button back mid-write.
  joined.add(id);
  lsSet('hc-joined', [...joined]);
  btn.disabled = true;
  btn.textContent = "You're in ✓";
  try {
    await store.join(id);
  } catch (err) {
    console.error(err);
    joined.delete(id);
    lsSet('hc-joined', [...joined]);
    // The event was removed by its creator (or expired server-side): stop
    // showing it rather than inviting a retry that can never succeed.
    if (err?.code === 'not-found') {
      if (detailId === id) { dismissSheets(); detailId = null; detailCache = null; }
      toast('This event is gone');
      return;
    }
    // Re-enable from the cached copy — the event may have left the viewport.
    if (detailId === id) fillDetail(events.get(id) ?? detailCache);
    toast(writeError(err, 'Could not join — try again'), 4500);
  }
});

// Share: draw the event and its map into an image, then hand it to the share
// sheet (js/share.js), which owns every route out of the browser.
$('#share-btn').addEventListener('click', async () => {
  if (!detailId) return;
  const ev = events.get(detailId) ?? detailCache;
  if (!ev) return;
  // Embed coordinates so the recipient — usually browsing another area — pans
  // straight to it even before the event doc is fetched.
  const url = `${location.origin}${location.pathname}#e=${detailId}` +
    `@${ev.lat.toFixed(5)},${ev.lng.toFixed(5)}`;
  const title = sentence(ev.a, ev.b, ev.c);
  try {
    const { openShare } = await shareModule();
    await openShare(ev, {
      url,
      title,
      text: `${title} — join me on humanconnect`,
      // Read off the screen, not re-derived: the card is a picture of what
      // the user is looking at, down to the button labels.
      joinsText: fmtJoins(ev.joins),
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

// Deleting is irreversible, so arm-then-confirm: first tap changes the label,
// second tap within the same view actually removes. Any re-render disarms.
$('#remove-btn').addEventListener('click', async () => {
  if (!detailId) return;
  const rm = $('#remove-btn');
  if (!rm.dataset.arm) {
    rm.dataset.arm = '1';
    rm.textContent = 'Tap again to remove';
    return;
  }
  delete rm.dataset.arm;
  rm.textContent = 'Remove this event';
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
    dismissSheets();
    toast('Event removed');
  } catch (err) {
    console.error('[humanconnect] remove failed:', err);
    detailId = id; // put the user back where they were
    detailCache = cache;
    fillDetail(events.get(id) ?? cache);
    toast(writeError(err, "Couldn't remove it — try again"), 4500);
  } finally {
    rm.disabled = false;
  }
});

$('#report-btn').addEventListener('click', () => {
  if (!detailId) return;
  const ev = events.get(detailId) ?? detailCache;
  const subject = encodeURIComponent(`[HumanConnect] Report event ${detailId}`);
  const body = encodeURIComponent(
    `Event: ${ev ? sentence(ev.a, ev.b, ev.c) : detailId}\nLocation: ${ev?.lat}, ${ev?.lng}\nReason: `,
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
  create: async () => { throw new Error('store not ready'); },
  join: async () => { throw new Error('store not ready'); },
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
