// ============================================================================
// Sharing an event.
//
// The thing worth sharing is a picture: the plan and the map it sits on
// (js/share-card.js draws it). Three ways out of here, in order of how well
// they carry that picture:
//
//   1. navigator.share({files}) — the OS sheet, so every installed app is a
//      target: WhatsApp, Instagram, Snapchat, Threads, Signal, anything. The
//      image travels with it. Mobile, and Safari/Edge on desktop.
//   2. Save / copy the image — the desktop path. Every composer accepts a
//      pasted or attached image.
//   3. Link intents — the web URLs each platform publishes. These can only
//      carry a link, never a file; that is a platform limit, not a bug, so the
//      sheet says so rather than pretending otherwise.
// ============================================================================

import { renderShareCard, canvasToBlob } from './share-card.js?v=msmfhh75';

const $ = (s) => document.querySelector(s);
const enc = encodeURIComponent;

// Platforms that publish a web share intent. Instagram and Snapchat have none
// — they are reachable only through the OS sheet, which is why route 1 above is
// the primary button rather than one target among many.
const TARGETS = [
  { label: 'WhatsApp', brand: '#25d366', href: (s) => `https://wa.me/?text=${enc(`${s.text} ${s.url}`)}` },
  { label: 'X',        brand: '#0f1419', href: (s) => `https://x.com/intent/post?text=${enc(s.text)}&url=${enc(s.url)}` },
  { label: 'Facebook', brand: '#1877f2', href: (s) => `https://www.facebook.com/sharer/sharer.php?u=${enc(s.url)}` },
  { label: 'Telegram', brand: '#229ed9', href: (s) => `https://t.me/share/url?url=${enc(s.url)}&text=${enc(s.text)}` },
  { label: 'Threads',  brand: '#000000', href: (s) => `https://www.threads.net/intent/post?text=${enc(`${s.text} ${s.url}`)}` },
  { label: 'LinkedIn', brand: '#0a66c2', href: (s) => `https://www.linkedin.com/sharing/share-offsite/?url=${enc(s.url)}` },
  { label: 'Reddit',   brand: '#ff4500', href: (s) => `https://www.reddit.com/submit?url=${enc(s.url)}&title=${enc(s.title)}` },
  { label: 'Email',    brand: '#8a8279', href: (s) => `mailto:?subject=${enc(s.title)}&body=${enc(`${s.text}\n\n${s.url}`)}` },
];

const canCopyImage = () =>
  typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';

let ui = null;        // { openSheet, toast } — owned by app.js
let card = null;      // { canvas, file, previewUrl, name }
let share = null;     // { url, title, text }
let building = false;
let wired = false;

// ---------------------------------------------------------------------------
// This module is imported lazily (nobody shares on their first second on the
// map), so it wires its own sheet the first time it is actually used.
function wire() {
  if (wired) return;
  wired = true;

  $('#share-native').addEventListener('click', shareNative);
  $('#share-save').addEventListener('click', saveImage);
  $('#share-copy').addEventListener('click', copyImage);
  $('#share-link').addEventListener('click', copyLink);

  $('#share-copy').hidden = !canCopyImage();

  const row = $('#share-targets');
  for (const t of TARGETS) {
    const a = document.createElement('a');
    a.className = 'chip share-target';
    a.style.setProperty('--brand', t.brand);
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = t.label;
    a.dataset.label = t.label;
    row.appendChild(a);
  }
  // One listener for the row: each anchor's href is set when the sheet opens,
  // and the image is offered to the clipboard on the way out so it can be
  // pasted into the composer that is about to open.
  row.addEventListener('click', (e) => {
    if (e.target.closest('.share-target')) copyImage({ quiet: true });
  });
}

/**
 * Build the card, then open the share sheet.
 * @param ev        the event
 * @param meta      { url, title, text, joinsText, endsText, place }
 * @param handlers  { openSheet, toast } from app.js
 */
export async function openShare(ev, meta, handlers) {
  ui = handlers;
  wire();
  if (building) return;
  const btn = $('#share-btn');
  const label = btn.textContent;
  building = true;
  btn.disabled = true;
  btn.textContent = 'Making image…';

  try {
    const canvas = await renderShareCard(ev, meta);
    // JPEG: universally accepted as an upload, and a tenth the size of PNG for
    // a card that is mostly map imagery.
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    const name = `humanconnect-${slug(meta.title)}.jpg`;

    if (card) URL.revokeObjectURL(card.previewUrl);
    card = {
      canvas,
      name,
      file: new File([blob], name, { type: 'image/jpeg' }),
      previewUrl: URL.createObjectURL(blob),
    };
    share = { url: meta.url, title: meta.title, text: meta.text };

    $('#share-img').src = card.previewUrl;
    $('#share-img').alt = `${meta.title} — the event and the map around it`;

    // A link intent can never carry a file. Say so, and name the route that
    // actually exists on THIS device rather than a button that may be hidden.
    const native = !!navigator.canShare?.({ files: [card.file] });
    $('#share-native').hidden = !native;
    $('#share-fine').textContent = native
      ? 'Link posts show a preview of humanconnect, not the event. For Instagram, Snapchat, or any post that should carry the picture, use Share image….'
      : 'Link posts show a preview of humanconnect, not the event. To post the picture itself, save or copy it and attach it in the composer.';
    for (const a of document.querySelectorAll('#share-targets .share-target')) {
      a.href = TARGETS.find((t) => t.label === a.dataset.label).href(share);
    }
    ui.openSheet($('#share-sheet'));
  } catch (err) {
    console.error('[humanconnect] share card failed:', err);
    // Never leave the user with nothing — the link alone still works.
    if (copyText(meta.url)) ui.toast('Could not make the image — link copied instead 🔗');
    else ui.toast('Could not prepare the share');
  } finally {
    building = false;
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------------------------------------------------------------------------
async function shareNative() {
  if (!card) return;
  try {
    await navigator.share({ files: [card.file], title: share.title, text: share.text, url: share.url });
  } catch (err) {
    // AbortError = the user closed the OS sheet. Anything else is worth saying.
    if (err?.name !== 'AbortError') ui.toast('Sharing was blocked — try saving the image');
  }
}

function saveImage() {
  if (!card) return;
  const a = document.createElement('a');
  a.href = card.previewUrl;
  a.download = card.name;
  a.click();
  ui.toast('Image saved 📸');
}

// PNG, not JPEG: image/jpeg is not a clipboard-writable type in Chrome. The
// Blob is handed over as a promise so Safari keeps the user gesture alive.
function copyImage({ quiet = false } = {}) {
  if (!card || !canCopyImage()) return;
  navigator.clipboard
    .write([new ClipboardItem({ 'image/png': canvasToBlob(card.canvas, 'image/png') })])
    .then(() => ui.toast('Image copied — paste it into your post'))
    .catch((err) => {
      if (!quiet) ui.toast('Could not copy the image — try Save image');
      else console.warn('[humanconnect] clipboard image copy skipped:', err);
    });
}

function copyLink() {
  if (copyText(share?.url)) ui.toast('Link copied 🔗');
  else ui.toast('Could not copy the link');
}

function copyText(text) {
  if (!text || !navigator.clipboard?.writeText) return false;
  navigator.clipboard.writeText(text).catch(() => {});
  return true;
}

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
