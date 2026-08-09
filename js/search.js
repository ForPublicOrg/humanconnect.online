// ============================================================================
// Place search. Geocoding by Photon (photon.komoot.io) — keyless, worldwide,
// built on OpenStreetMap data, and CORS-friendly, which keeps the site
// frontend-only. Results are biased toward the current map view so "puram"
// finds the one near you, not the one three states away.
//
// UX contract: search-as-you-type (debounced, in-flight requests aborted),
// ↑/↓ + Enter keyboard navigation, Esc or map tap closes. Picking a result
// flies the map there — fitBounds when Photon provides an extent (cities,
// districts), a close zoom for point results (landmarks, streets).
// ============================================================================

const PHOTON = 'https://photon.komoot.io/api/';
const PHOTON_REVERSE = 'https://photon.komoot.io/reverse';
const MIN_CHARS = 3;
const DEBOUNCE_MS = 280;
const LIMIT = 6;

const $ = (s) => document.querySelector(s);

// --------------------------------------------------------------------------
// Reverse geocoding — "where is this pin?" for the event detail sheet.
// Best effort: returns a short human line ("Indiranagar, Bengaluru,
// Karnataka") or null. Cached per rounded coordinate so reopening the same
// event never refetches.
// --------------------------------------------------------------------------
const revCache = new Map();

export async function reverseGeocode(lat, lng) {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (revCache.has(key)) return revCache.get(key);
  let label = null;
  try {
    const res = await fetch(`${PHOTON_REVERSE}?lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}&lang=en`);
    if (res.ok) {
      const geo = await res.json();
      const p = geo.features?.[0]?.properties ?? {};
      label = [p.name ?? p.street, p.suburb, p.city ?? p.district, p.state]
        .filter(Boolean)
        .filter((part, i, arr) => arr.indexOf(part) === i)
        .slice(0, 3)
        .join(', ') || null;
    }
  } catch { /* offline or blocked — the Maps link still works without it */ }
  if (revCache.size > 80) revCache.clear();
  revCache.set(key, label);
  return label;
}

export function initSearch({ map }) {
  const panel = $('#search-panel');
  const input = $('#search-input');
  const list = $('#search-results');
  const btn = $('#search-btn');

  let debounceTimer = null;
  let inflight = null;      // AbortController for the request on the wire
  let results = [];         // last rendered feature list
  let cursor = -1;          // keyboard-highlighted row, -1 = none

  // ------------------------------------------------------------------ open/close
  const open = () => {
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    input.focus();
    input.select();
  };
  const close = () => {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    clearResults();
    clearTimeout(debounceTimer);
    inflight?.abort();
  };
  const toggle = () => (panel.hidden ? open() : close());

  btn.addEventListener('click', toggle);

  // Tapping the map dismisses search — and that tap must be SWALLOWED by the
  // map's own click handler, exactly like taps that dismiss sheets. Without
  // this, the dismiss-tap falls through to startCreate and the user who just
  // wanted to close search finds a create sheet opening under their finger.
  let swallowTapUntil = 0;
  map.on('mousedown', () => {
    if (!panel.hidden) {
      close();
      swallowTapUntil = Date.now() + 600;
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) { close(); return; }
    // "/" focuses search from anywhere (unless typing in another field)
    if (e.key === '/' && panel.hidden && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) {
      e.preventDefault();
      open();
    }
  });

  // ------------------------------------------------------------------ results UI
  function clearResults() {
    results = [];
    cursor = -1;
    list.innerHTML = '';
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  }

  // One line per place: bold name, soft context ("Indiranagar — Bengaluru,
  // Karnataka"). Context skips parts that duplicate the name.
  function labelFor(p) {
    const context = [p.city ?? p.district, p.state, p.country]
      .filter((part) => part && part !== p.name)
      .filter((part, i, arr) => arr.indexOf(part) === i)
      .join(', ');
    return { name: p.name ?? 'Unnamed place', context };
  }

  function render() {
    list.innerHTML = '';
    for (let i = 0; i < results.length; i++) {
      const { name, context } = labelFor(results[i].properties ?? {});
      const li = document.createElement('li');
      li.role = 'option';
      li.id = `search-opt-${i}`;
      const b = document.createElement('button');
      b.type = 'button';
      const strong = document.createElement('strong');
      strong.textContent = name;
      b.appendChild(strong);
      if (context) {
        const span = document.createElement('span');
        span.textContent = context;
        b.appendChild(span);
      }
      b.addEventListener('click', () => pick(i));
      li.appendChild(b);
      list.appendChild(li);
    }
    list.hidden = results.length === 0;
    input.setAttribute('aria-expanded', String(results.length > 0));
    highlight(-1);
  }

  function renderNote(text) {
    list.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'note';
    li.textContent = text;
    list.appendChild(li);
    list.hidden = false;
  }

  function highlight(i) {
    cursor = i;
    [...list.children].forEach((li, j) => li.classList.toggle('active', j === i));
    input.setAttribute('aria-activedescendant', i >= 0 ? `search-opt-${i}` : '');
  }

  // ------------------------------------------------------------------ geocoding
  async function query(q) {
    inflight?.abort();
    const ctl = new AbortController();
    inflight = ctl;
    const c = map.getCenter();
    const url = `${PHOTON}?q=${encodeURIComponent(q)}&limit=${LIMIT}&lang=en` +
                `&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}`;
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error(`geocoder ${res.status}`);
      const geo = await res.json();
      if (ctl.signal.aborted) return;
      results = (geo.features ?? []).filter((f) => f?.geometry?.coordinates?.length === 2);
      if (results.length) render();
      else renderNote('No places found — try a different spelling');
    } catch (err) {
      if (ctl.signal.aborted) return;   // superseded by newer keystrokes
      console.warn('[humanconnect] place search failed:', err);
      // Drop stale results BEFORE showing the note — otherwise ↑/↓/Enter
      // still navigate the previous query's list behind the error message.
      results = [];
      cursor = -1;
      renderNote('Search is unreachable right now — try again in a moment');
    }
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(debounceTimer);
    if (q.length < MIN_CHARS) {
      inflight?.abort(); // a response landing now would resurrect stale results
      clearResults();
      return;
    }
    debounceTimer = setTimeout(() => query(q), DEBOUNCE_MS);
  });

  // ------------------------------------------------------------------ picking
  function pick(i) {
    const f = results[i];
    if (!f) return;
    const [lng, lat] = f.geometry.coordinates;
    const extent = f.properties?.extent; // [minLon, maxLat, maxLon, minLat]
    close();
    input.blur();
    if (extent?.length === 4) {
      map.flyToBounds([[extent[1], extent[0]], [extent[3], extent[2]]], {
        maxZoom: 16, duration: 0.9,
      });
    } else {
      map.flyTo([lat, lng], Math.max(map.getZoom(), 15), { duration: 0.9 });
    }
  }

  input.addEventListener('keydown', (e) => {
    if (list.hidden || !results.length) {
      if (e.key === 'Enter') {
        // Enter with no visible results: search immediately, skip the debounce.
        const q = input.value.trim();
        if (q.length >= MIN_CHARS) { clearTimeout(debounceTimer); query(q); }
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight((cursor + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight((cursor - 1 + results.length) % results.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(cursor === -1 ? 0 : cursor); }
  });

  // Lets the map's tap handler ignore the click whose mousedown dismissed us.
  return { tapSwallowed: () => Date.now() < swallowTapUntil };
}
