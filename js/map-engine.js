// ============================================================================
// Map engine loader. Two providers behind one call:
//
//   carto  — keyless OpenStreetMap/CARTO tiles. Instant, great for demo/dev,
//            but draws international boundaries per OSM convention, which is
//            NOT the Survey of India depiction required for maps published
//            for an Indian audience.
//   mappls — Mappls (MapmyIndia), an Indian provider whose maps follow the
//            official Government of India / Survey of India boundaries
//            (J&K, Ladakh, Arunachal Pradesh shown fully as India).
//            Needs a free API key: https://apis.mappls.com/console/
//            Their raster SDK is Leaflet-based, so the whole app works on it
//            unchanged.
//
// Returns { map, provider } where `map` is a Leaflet map either way.
// If Mappls is requested but fails to load, falls back to Carto so the site
// never white-screens.
// ============================================================================

import { MAP } from './config.js';

const LEAFLET_VER = '1.9.4';
const LEAFLET_JS_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
const LEAFLET_CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';

function loadScript(src, integrity) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    if (integrity) { s.integrity = integrity; s.crossOrigin = ''; }
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

function loadCss(href, integrity) {
  return new Promise((resolve, reject) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    if (integrity) { l.integrity = integrity; l.crossOrigin = ''; }
    l.onload = resolve;
    l.onerror = () => reject(new Error('Failed to load ' + href));
    document.head.appendChild(l);
  });
}

export async function buildMap(containerId, view) {
  let built = null;
  if (MAP.provider === 'mappls' && MAP.mapplsKey) {
    try {
      built = await buildMappls(containerId, view);
    } catch (err) {
      console.warn('[humanconnect] Mappls failed, falling back to Carto tiles:', err);
      // Undo any partial Leaflet init so the Carto fallback can bind the
      // container instead of throwing "Map container is already initialized".
      resetContainer(containerId);
    }
  }
  if (!built) built = await buildCarto(containerId, view);

  // Marker clustering — required UX at scale (hundreds of events per city).
  // Loaded after Leaflet since the plugin attaches to the global L.
  try {
    await Promise.all([
      loadCss(`https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css`),
      loadScript(`https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js`),
    ]);
    built.clusters = L.markerClusterGroup({
      maxClusterRadius: 44,
      disableClusteringAtZoom: 15,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: false,
      iconCreateFunction(cluster) {
        const n = cluster.getChildCount();
        const d = Math.round(Math.min(42 + 5 * Math.sqrt(n), 76));
        return L.divIcon({
          className: 'hc-marker',
          html: `<div class="hc-cluster" style="--d:${d}px"><b>${n}</b><span>plans</span></div>`,
          iconSize: [0, 0],
        });
      },
    });
    built.map.addLayer(built.clusters);
  } catch (err) {
    console.warn('[humanconnect] clustering unavailable, using plain markers:', err);
    built.clusters = null;
  }
  return built;
}

// A Leaflet map stamps `_leaflet_id` on its container; unless that is cleared,
// a second L.map() on the same element throws "already initialized".
function resetContainer(containerId) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.replaceChildren();
  delete c._leaflet_id;
  c.className = c.className.replace(/\bleaflet-\S+/g, '').trim();
}

// ---------------------------------------------------------------------------
async function buildMappls(containerId, view) {
  await loadScript(
    `https://apis.mappls.com/advancedmaps/api/${encodeURIComponent(MAP.mapplsKey)}/map_sdk?v=3.0&layer=raster`,
  );
  const NS = window.mappls || window.Mappls || window.MapmyIndia;
  if (!NS?.Map || !window.L) throw new Error('Mappls raster SDK did not initialise');

  const raw = new NS.Map(containerId, {
    center: [view.lat, view.lng],
    zoom: view.zoom,
    zoomControl: false,
    search: false,
    location: false,
    fullscreenControl: false,
  });
  // Their raster map is (or wraps) a real Leaflet map — verify before trusting.
  const map = raw instanceof window.L.Map ? raw
    : raw?.map instanceof window.L.Map ? raw.map
    : null;
  if (!map) {
    // Tear the half-built map down so the container is reusable by Carto.
    try { (raw?.remove ?? raw?.map?.remove)?.call(raw?.map ?? raw); } catch {}
    throw new Error('Mappls map is not Leaflet-compatible');
  }
  return { map, provider: 'mappls' };
}

// ---------------------------------------------------------------------------
async function buildCarto(containerId, view) {
  await Promise.all([
    loadCss(`https://unpkg.com/leaflet@${LEAFLET_VER}/dist/leaflet.css`, LEAFLET_CSS_SRI),
    window.L ? Promise.resolve()
             : loadScript(`https://unpkg.com/leaflet@${LEAFLET_VER}/dist/leaflet.js`, LEAFLET_JS_SRI),
  ]);

  const map = L.map(containerId, {
    zoomControl: false,
    worldCopyJump: true,
  });
  map.attributionControl.setPrefix(false);
  map.setView([view.lat, view.lng], view.zoom);

  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  let tiles = null;
  const setTiles = () => {
    if (tiles) map.removeLayer(tiles);
    const style = dark.matches ? 'dark_all' : 'rastertiles/voyager';
    tiles = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(map);
  };
  setTiles();
  dark.addEventListener?.('change', setTiles);

  return { map, provider: 'carto' };
}
