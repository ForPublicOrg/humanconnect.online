// ============================================================================
// Map engine. Worldwide CARTO tiles (keyless) + a corrective overlay of
// India's official boundary.
//
// Why the overlay: raster tiles bake the border into the image, and OSM/CARTO
// draw India's disputed boundaries (J&K, Ladakh/Aksai Chin, Arunachal) per
// international convention — NOT the Survey of India depiction. We can't
// repaint tile pixels, so we draw India's official national boundary
// (data/india-border.geojson) as a thin line ON TOP, in a colour that matches
// the basemap's own border lines, so the presented border is India's official
// claim. The site still works worldwide — this only adds India's outline.
//
// Returns { map, clusters }.
// ============================================================================

const LEAFLET_VER = '1.9.4';
const LEAFLET_JS_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
const LEAFLET_CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';

// Colours chosen to match CARTO's own admin-boundary lines in each theme, so
// the corrective line reads as part of the basemap rather than an overlay.
const BORDER_COLOR = { light: '#b3a59a', dark: '#5b5f66' };

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
    tiles.bringToBack();
  };
  setTiles();

  // India boundary correction — loaded async, non-blocking.
  const border = addIndiaBorder(map, dark.matches);

  dark.addEventListener?.('change', () => {
    setTiles();
    border.then((layer) => layer?.setStyle({ color: BORDER_COLOR[dark.matches ? 'dark' : 'light'] }));
  });

  // Marker clustering — required UX at scale (hundreds of events per city).
  let clusters = null;
  try {
    await Promise.all([
      loadCss(`https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css`),
      loadScript(`https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js`),
    ]);
    clusters = L.markerClusterGroup({
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
    map.addLayer(clusters);
  } catch (err) {
    console.warn('[humanconnect] clustering unavailable, using plain markers:', err);
  }

  return { map, clusters };
}

// ---------------------------------------------------------------------------
// Draw India's official boundary on its own pane, above tiles but below
// markers/clusters. Failure is non-fatal — the map still works worldwide.
async function addIndiaBorder(map, isDark) {
  try {
    const res = await fetch('data/india-border.geojson');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const geo = await res.json();

    // Dedicated pane sitting just above the tile pane (200) and below
    // overlays/markers (400/600).
    const pane = map.createPane('india-border');
    pane.style.zIndex = 250;
    pane.style.pointerEvents = 'none';

    const layer = L.geoJSON(geo, {
      pane: 'india-border',
      interactive: false,
      renderer: L.canvas({ pane: 'india-border' }),
      style: {
        color: BORDER_COLOR[isDark ? 'dark' : 'light'],
        weight: 1,
        opacity: 0.95,
        fill: false,
        lineJoin: 'round',
        lineCap: 'round',
      },
    }).addTo(map);
    return layer;
  } catch (err) {
    console.warn('[humanconnect] India boundary overlay failed to load:', err);
    return null;
  }
}
