// ============================================================================
// Share card — a screenshot of the event, drawn rather than captured.
//
// Why not capture the real DOM: no browser API does that, and the
// html-to-canvas libraries are large and render Leaflet badly. So we redraw
// the same screen from the same sources — CARTO tiles at a fixed zoom, India's
// official boundary on top (js/map-engine.js explains why that correction
// exists; an exported image is *published*, so it matters more here than
// anywhere), the pin, the header pill, and the detail sheet with its Join and
// Share buttons.
//
// It is a picture of the app, not an advert for it: every word in the image is
// a word that is on the user's screen at the moment they tap Share. Metrics
// below are the stylesheet's CSS pixels doubled — change css/style.css and
// these need the same change.
//
// The canvas must stay untainted or toBlob() throws and there is nothing to
// share: every tile is fetched with crossOrigin='anonymous' (CARTO serves
// Access-Control-Allow-Origin: *) and the fonts are same-origin.
// ============================================================================

import { effectiveTheme } from './theme.js';
import { itemEmoji, itemColor, sentence, KIND_HELP } from './words.js';
import { TILE_STYLES, BORDER_COLOR, BORDER_GEOJSON, pinDiameter } from './map-engine.js';

// 4:5 — a phone's proportions, and the tallest shape no platform crops badly.
const W = 1080;
const H = 1350;
const SCALE = 2;     // @2x tiles, and the factor every CSS metric is doubled by
const ZOOM = 15;     // neighbourhood scale — streets named, ~2.4 km across
const TILE = 256;

const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const EMOJI = "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";

const PAD = 36;                 // .sheet-body padding, 18px doubled
const R = 24;                   // --r: 12px doubled
const TILE_TIMEOUT_MS = 6000;

// ---------------------------------------------------------------------------
// Web Mercator, in world pixels at a given zoom (256 px tiles)
// ---------------------------------------------------------------------------
function project(lat, lng, z) {
  const s = TILE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * s,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s,
  };
}

// Palette read live from the stylesheet, so the card matches the theme the user
// is actually looking at and never drifts from css/style.css.
function palette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    paper: v('--paper', '#faf9f6'),
    paper2: v('--paper-2', '#efece6'),
    ink: v('--ink', '#232120'),
    inkSoft: v('--ink-soft', '#6f6a63'),
    line: v('--line', 'rgba(35,33,32,0.13)'),
    accent: v('--accent', '#0f9d6b'),
    accentDeep: v('--accent-deep', '#047857'),
  };
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------
function loadTile(url) {
  return new Promise((resolve) => {
    const img = new Image();
    // Keeps the canvas exportable. Without it the tile paints fine and then
    // toBlob() throws SecurityError — a failure that only shows up at export.
    img.crossOrigin = 'anonymous';
    const done = (val) => { clearTimeout(timer); resolve(val); };
    const timer = setTimeout(() => done(null), TILE_TIMEOUT_MS);
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = url;
  });
}

// The boundary file is small and immutable — fetch it at most once per session.
let borderP = null;
function indiaBorder() {
  borderP ??= fetch(BORDER_GEOJSON)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return borderP;
}

async function drawMap(ctx, ev, pinY, theme) {
  const world = project(ev.lat, ev.lng, ZOOM);
  const x0 = world.x - W / 2 / SCALE;   // world px at the card's left edge
  const y0 = world.y - pinY / SCALE;    // ...and at its top edge
  const n = 2 ** ZOOM;

  const style = TILE_STYLES[theme] ?? TILE_STYLES.light;
  const jobs = [];
  for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + H / SCALE) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue; // above the north pole / below the south
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + W / SCALE) / TILE); tx++) {
      const wx = ((tx % n) + n) % n; // wrap across the antimeridian
      const sub = 'abcd'[Math.abs(tx + ty) % 4];
      const url = `https://${sub}.basemaps.cartocdn.com/${style}/${ZOOM}/${wx}/${ty}@2x.png`;
      jobs.push(loadTile(url).then((img) => ({ img, tx, ty })));
    }
  }

  const [tiles, geo] = await Promise.all([Promise.all(jobs), indiaBorder()]);

  // A missing tile just leaves paper showing — better than failing the share.
  for (const { img, tx, ty } of tiles) {
    if (img) ctx.drawImage(img, (tx * TILE - x0) * SCALE, (ty * TILE - y0) * SCALE, TILE * SCALE, TILE * SCALE);
  }
  if (geo) drawBorder(ctx, geo, x0, y0, theme);
}

// India's official national boundary, drawn over the tiles exactly as the live
// map draws it. Lines outside the frame are skipped — at this zoom that is
// almost all of them.
function drawBorder(ctx, geo, x0, y0, theme) {
  const lines = geo?.geometry?.coordinates;
  if (!Array.isArray(lines)) return;

  ctx.save();
  ctx.strokeStyle = BORDER_COLOR[theme] ?? BORDER_COLOR.light;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.95;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const line of lines) {
    if (!Array.isArray(line) || line.length < 2) continue;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const pts = line.map(([lng, lat]) => {
      const p = project(lat, lng, ZOOM);
      const x = (p.x - x0) * SCALE;
      const y = (p.y - y0) * SCALE;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      return [x, y];
    });
    if (maxX < -8 || minX > W + 8 || maxY < -8 || minY > H + 8) continue;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
  ctx.restore();
}

// The pin — same geometry as .hc-pin in css/style.css, doubled. A help request
// is the rounded callout .hc-pin.help draws instead of a circle; the picture
// has to carry the same at-a-glance difference the map does.
function drawPin(ctx, ev, pinY, pal) {
  const d = pinDiameter(ev.joins) * SCALE;
  const ring = itemColor(ev.k, ev.b);
  const help = ev.k === KIND_HELP;
  const cx = W / 2;
  const cy = pinY - 14 - d / 2; // 14 = the 7px gap above the stem, doubled
  const r = d / 2;
  const CORNER = 0.3;           // .hc-pin.help border-radius, as a fraction

  // Path the pin's outline, inset by `inset` px on every side (negative for
  // the halo outside it). Half the ring width is where a CSS `border` sits.
  function face(inset) {
    if (!help) {
      ctx.beginPath();
      ctx.arc(cx, cy, r - inset, 0, Math.PI * 2);
      return;
    }
    const side = d - inset * 2;
    roundRect(ctx, cx - r + inset, cy - r + inset, side, side, side * CORNER);
  }

  ctx.save();
  ctx.shadowColor = 'rgba(20, 22, 26, 0.35)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;

  // Stem first, so the face's shadow lands on top of it rather than beside.
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy + r - 2);
  ctx.lineTo(cx + 12, cy + r - 2);
  ctx.lineTo(cx, pinY);
  ctx.closePath();
  ctx.fillStyle = ring;
  ctx.fill();

  face(0);
  ctx.fillStyle = pal.paper;
  ctx.fill();
  ctx.restore();

  // Help pins carry a tinted face on the map (a 10% wash of the ring colour).
  if (help) {
    ctx.save();
    ctx.globalAlpha = 0.1;
    face(0);
    ctx.fillStyle = ring;
    ctx.fill();
    ctx.restore();
  }

  face(3);
  ctx.lineWidth = 6;
  ctx.strokeStyle = ring;
  ctx.stroke();

  // ...and the halo the live pin pulses. Still images don't pulse, so it is
  // drawn once, at the animation's most legible frame.
  if (help) {
    ctx.save();
    ctx.globalAlpha = 0.4;
    face(-14);
    ctx.lineWidth = 4;
    ctx.strokeStyle = ring;
    ctx.stroke();
    ctx.restore();
  }

  emoji(ctx, itemEmoji(ev.k, ev.b), cx, cy + 2, Math.round(d * 0.5), pal);

  if (ev.joins > 0) {
    const label = String(ev.joins);
    ctx.font = `800 22px ${SANS}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const w = Math.max(40, ctx.measureText(label).width + 20);
    const bx = cx + r * 0.72;
    const by = cy - r * 0.72;
    roundRect(ctx, bx - w / 2, by - 20, w, 40, 20);
    ctx.fillStyle = pal.ink;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = pal.paper;
    ctx.stroke();
    ctx.fillStyle = pal.paper;
    ctx.fillText(label, bx, by + 1);
  }
  resetText(ctx);
}

// Required by the OpenStreetMap and CARTO licences wherever their imagery is
// redistributed — and a share card is redistribution.
function drawAttribution(ctx, bottom, pal) {
  const text = '© OpenStreetMap  © CARTO';
  ctx.font = `500 18px ${SANS}`;
  const w = ctx.measureText(text).width + 20;
  const h = 30;
  const x = W - w - 14;
  const y = bottom - h - 14;

  ctx.save();
  ctx.globalAlpha = 0.82;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = pal.paper;
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = pal.inkSoft;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 10, y + h / 2 + 1);
  resetText(ctx);
}

// ---------------------------------------------------------------------------
// Chrome — the masthead pill, exactly as .brand renders it
// ---------------------------------------------------------------------------
function drawHeaderPill(ctx, liveCount, pal) {
  const h = 82;
  const x = 24;
  const y = 24;

  ctx.font = `italic 550 38px ${SERIF}`;
  const nameW = ctx.measureText('humanconnect').width;
  ctx.font = `700 38px ${SANS}`;
  const tldW = ctx.measureText('.online').width;
  ctx.font = `500 24px ${SANS}`;
  const countW = liveCount ? ctx.measureText(liveCount).width + 20 : 0;
  const w = 28 + 18 + 20 + nameW + tldW + countW + 28;

  ctx.save();
  ctx.shadowColor = 'rgba(35, 38, 43, 0.16)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, x, y, w, h, R);
  ctx.fillStyle = pal.paper;
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 2;
  ctx.strokeStyle = pal.line;
  ctx.stroke();

  const baseline = y + h / 2 + 13;
  ctx.beginPath();
  ctx.arc(x + 28, y + h / 2, 9, 0, Math.PI * 2);
  ctx.fillStyle = pal.accent;
  ctx.fill();

  let tx = x + 28 + 18;
  ctx.font = `italic 550 38px ${SERIF}`;
  ctx.fillStyle = pal.ink;
  ctx.fillText('humanconnect', tx, baseline);
  tx += nameW;
  ctx.font = `700 38px ${SANS}`;
  ctx.fillStyle = pal.accentDeep;
  ctx.fillText('.online', tx, baseline);

  if (liveCount) {
    ctx.font = `500 24px ${SANS}`;
    ctx.fillStyle = pal.inkSoft;
    ctx.fillText(liveCount, tx + tldW + 20, baseline - 2);
  }
}

// ---------------------------------------------------------------------------
// The detail sheet, redrawn: medallion, name, meta, place, Join and Share
// ---------------------------------------------------------------------------
function wrap(ctx, text, maxW) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// Try progressively smaller sizes until the name fits two lines. Three long
// words ("Neighborhood Public Speaking Tournament") is the worst case.
function fitTitle(ctx, text, maxW) {
  for (const size of [46, 40, 36]) {
    ctx.font = `italic 550 ${size}px ${SERIF}`;
    const lines = wrap(ctx, text, maxW);
    if (lines.length <= 2) return { size, lines };
  }
  ctx.font = `italic 550 36px ${SERIF}`;
  return { size: 36, lines: wrap(ctx, text, maxW).slice(0, 2) };
}

function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

const MEDALLION = 108;   // #detail-emoji, 54px doubled
const GUTTER = 28;       // .detail-top gap, 14px doubled
const BTN_H = 102;       // 15px padding + 16px text, doubled

const META_SIZE = 27;     // .detail-meta font-size, 13.5px doubled
const META_GAP = 28;      // its column-gap, 14px doubled
const META_ROW_GAP = 12;  // its row-gap, 6px doubled

// The pieces of .detail-meta, in DOM order and with the weights the stylesheet
// gives them: the join count in emerald, the start time carrying more ink than
// the countdown beside it. A start time is optional, so this list is too.
function metaSegments(meta, pal) {
  return [
    { text: meta.joinsText, font: `700 ${META_SIZE}px ${SANS}`, fill: pal.accentDeep },
    { text: meta.startsText, font: `600 ${META_SIZE}px ${SANS}`, fill: pal.ink },
    { text: meta.endsText, font: `500 ${META_SIZE}px ${SANS}`, fill: pal.inkSoft },
  ].filter((s) => s.text);
}

// .detail-meta is a wrapping flex row, so this wraps too — three pieces don't
// always fit beside a medallion, and pushing the countdown off the edge of a
// published image is not an option.
function layoutMeta(ctx, segs, maxW) {
  const lines = [[]];
  let used = 0;
  for (const seg of segs) {
    ctx.font = seg.font;
    const w = ctx.measureText(seg.text).width;
    const line = lines[lines.length - 1];
    if (line.length && used + META_GAP + w > maxW) {
      lines.push([{ ...seg, w }]);
      used = w;
    } else {
      line.push({ ...seg, w });
      used += (line.length > 1 ? META_GAP : 0) + w;
    }
  }
  return lines;
}

// Measured before anything is drawn: the sheet's height decides where the map
// ends and where the pin has to sit to stay visible above it.
function measureSheet(ctx, ev, meta, pal) {
  const textX = PAD + MEDALLION + GUTTER;
  const maxW = W - textX - PAD;
  const title = fitTitle(ctx, sentence(ev.k, ev.a, ev.b, ev.c), maxW);
  const titleLh = Math.round(title.size * 1.18);

  const metaLines = layoutMeta(ctx, metaSegments(meta, pal), maxW);
  const metaH = metaLines.length * META_SIZE + (metaLines.length - 1) * META_ROW_GAP;

  let textH = title.lines.length * titleLh + 12 + metaH;  // + .detail-meta
  if (meta.place) textH += 10 + 25;                       // + #detail-place
  const headH = Math.max(MEDALLION, textH);

  return {
    title, titleLh, textX, maxW, metaLines, textH, headH,
    height: PAD + headH + 32 + BTN_H + PAD,
  };
}

function drawSheet(ctx, ev, meta, m, top, pal) {
  // .sheet — paper card with rounded top corners, hairline, lifted shadow
  ctx.save();
  ctx.shadowColor = 'rgba(20, 22, 26, 0.34)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = -8;
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(0, top + 32);
  ctx.arcTo(0, top, 32, top, 32);
  ctx.lineTo(W - 32, top);
  ctx.arcTo(W, top, W, top + 32, 32);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = pal.paper;
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 2;
  ctx.strokeStyle = pal.line;
  ctx.stroke();

  const headTop = top + PAD;

  // #detail-emoji — paper disc, category ring; the rounded callout of
  // #detail-emoji.help when this is a request
  const cy = headTop + m.headH / 2;
  const mx = PAD + MEDALLION / 2;
  const mr = MEDALLION / 2 - 3;
  if (ev.k === KIND_HELP) roundRect(ctx, mx - mr, cy - mr, mr * 2, mr * 2, mr * 2 * 0.3);
  else { ctx.beginPath(); ctx.arc(mx, cy, mr, 0, Math.PI * 2); }
  ctx.fillStyle = pal.paper;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = itemColor(ev.k, ev.b);
  ctx.stroke();
  emoji(ctx, itemEmoji(ev.k, ev.b), mx, cy + 2, 52, pal);

  // #detail-title, vertically centred against the medallion like the flex row
  let y = headTop + Math.max(0, (m.headH - m.textH) / 2) + m.title.size * 0.82;
  ctx.font = `italic 550 ${m.title.size}px ${SERIF}`;
  ctx.fillStyle = pal.ink;
  for (const line of m.title.lines) {
    ctx.fillText(line, m.textX, y);
    y += m.titleLh;
  }
  y += 12 + 6;

  // .detail-meta — the join count, when it starts, and the countdown, laid out
  // on however many lines they need.
  m.metaLines.forEach((line, i) => {
    if (i) y += META_SIZE + META_ROW_GAP;
    let x = m.textX;
    for (const seg of line) {
      ctx.font = seg.font;
      ctx.fillStyle = seg.fill;
      ctx.fillText(seg.text, x, y);
      x += seg.w + META_GAP;
    }
  });

  // #detail-place — the address and its ↗, exactly as the sheet has it
  if (meta.place) {
    y += 10 + 22;
    ctx.font = `500 25px ${SANS}`;
    ctx.fillStyle = pal.inkSoft;
    ctx.fillText(ellipsize(ctx, meta.place, m.maxW), m.textX, y);
  }

  drawActions(ctx, meta, top + PAD + m.headH + 32, pal);
}

// .detail-actions — the emerald Join button and the ghost Share button, with
// whatever they say on the user's screen right now.
function drawActions(ctx, { joinLabel, shareLabel }, top, pal) {
  ctx.font = `600 30px ${SANS}`;
  const shareW = ctx.measureText(shareLabel).width + 64;
  const joinW = W - PAD * 2 - 20 - shareW;

  const grad = ctx.createLinearGradient(PAD, top, PAD + joinW, top + BTN_H);
  grad.addColorStop(0, '#047857');
  grad.addColorStop(1, '#065f46');
  roundRect(ctx, PAD, top, joinW, BTN_H, R);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.font = `700 32px ${SANS}`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(joinLabel, PAD + joinW / 2, top + BTN_H / 2 + 1);

  roundRect(ctx, W - PAD - shareW, top, shareW, BTN_H, R);
  ctx.lineWidth = 2;
  ctx.strokeStyle = pal.line;
  ctx.stroke();
  ctx.font = `600 30px ${SANS}`;
  ctx.fillStyle = pal.ink;
  ctx.fillText(shareLabel, W - PAD - shareW / 2, top + BTN_H / 2 + 1);
  resetText(ctx);
}

// ---------------------------------------------------------------------------
function emoji(ctx, glyph, cx, cy, size, pal) {
  // Colour-glyph emoji still take the fill's ALPHA — inheriting a translucent
  // fillStyle from an earlier call renders them as ghosts.
  ctx.fillStyle = pal.ink;
  ctx.font = `${size}px ${EMOJI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, cx, cy);
  resetText(ctx);
}

function resetText(ctx) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Draw the share card for an event.
 * @param ev    the event ({a,b,c,lat,lng,joins})
 * @param meta  the strings currently on screen — joinsText, startsText,
 *              endsText, place, joinLabel, shareLabel, liveCount — so the
 *              picture and the app can never disagree.
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderShareCard(ev, meta = {}) {
  const theme = effectiveTheme();
  const pal = palette();

  // The display face is lazy (font-display: swap) — without this the sheet can
  // silently fall back to Georgia on the first share of a session.
  try { await document.fonts.load(`italic 550 46px 'Fraunces'`); } catch { /* fallback face */ }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = pal.paper;
  ctx.fillRect(0, 0, W, H);

  // Lay the sheet out first: it decides how much map is visible, and the pin
  // has to land in that strip rather than behind the sheet — the same rule
  // flyToEvent() follows on the live map.
  const m = measureSheet(ctx, ev, meta, pal);
  const sheetTop = H - m.height;
  const pinY = Math.round(sheetTop * 0.46);

  await drawMap(ctx, ev, pinY, theme);
  drawPin(ctx, ev, pinY, pal);
  drawAttribution(ctx, sheetTop, pal);
  drawHeaderPill(ctx, meta.liveCount, pal);
  drawSheet(ctx, ev, meta, m, sheetTop, pal);

  return canvas;
}

/** Canvas → Blob. JPEG for sharing (every platform takes it), PNG for the clipboard. */
export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas encode failed'))),
      type,
      quality,
    );
  });
}
