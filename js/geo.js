// ============================================================================
// Geohash utilities for viewport-scoped queries.
//
// Every event stores `g4` — its 4-character geohash cell (~39 × 20 km).
// Visitors subscribe only to the cells covering their viewport, so a visitor
// looking at Pune never pays to download events in Delhi. When the viewport
// is wider than MAX_CELLS cells (country-level zoom), the app falls back to
// a single capped nationwide query.
// ============================================================================

const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';

// Cell size of a 4-character geohash (20 bits: 10 for lng, 10 for lat).
export const LAT_STEP = 180 / 1024;
export const LNG_STEP = 360 / 1024;

/** 4-character geohash of a point. */
export function geohash4(lat, lng) {
  let minLat = -90, maxLat = 90, minLng = -180, maxLng = 180;
  let hash = '', ch = 0, bit = 0, even = true;
  while (hash.length < 4) {
    if (even) {
      const m = (minLng + maxLng) / 2;
      if (lng >= m) { ch = ch * 2 + 1; minLng = m; } else { ch = ch * 2; maxLng = m; }
    } else {
      const m = (minLat + maxLat) / 2;
      if (lat >= m) { ch = ch * 2 + 1; minLat = m; } else { ch = ch * 2; maxLat = m; }
    }
    even = !even;
    if (++bit === 5) { hash += B32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

/**
 * Geohash cells covering a bounding box (with the box clamped to the world).
 * Returns null when the box needs more than maxCells cells — the signal to
 * use the nationwide fallback query instead.
 */
const wrapLng = (x) => ((x + 180) % 360 + 360) % 360 - 180;

export function cellsForBounds(south, west, north, east, maxCells = 25) {
  south = Math.max(south, -90);
  north = Math.min(north, 90);
  if (south > north) return null;

  // Leaflet can hand back longitudes outside ±180 at low zoom; wrap rather
  // than clamp so far-side cells aren't collapsed onto the ±180 edge. If the
  // span covers the world or crosses the antimeridian, use the global query.
  if (east - west >= 360) return null;
  west = wrapLng(west);
  east = wrapLng(east);
  if (west > east) return null;

  const cells = new Set();
  const lat0 = Math.floor(south / LAT_STEP) * LAT_STEP + LAT_STEP / 2;
  const lng0 = Math.floor(west / LNG_STEP) * LNG_STEP + LNG_STEP / 2;
  for (let lat = lat0; lat < north + LAT_STEP / 2; lat += LAT_STEP) {
    for (let lng = lng0; lng < east + LNG_STEP / 2; lng += LNG_STEP) {
      cells.add(geohash4(
        Math.min(Math.max(lat, -89.9999), 89.9999),
        wrapLng(lng),
      ));
      if (cells.size > maxCells) return null;
    }
  }
  return [...cells];
}
