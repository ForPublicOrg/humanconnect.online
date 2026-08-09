// ============================================================================
// The legal-safety model, enforced server-side.
//
// This used to live in firestore.rules. It moved here the moment writes moved
// behind the API, because the Admin SDK bypasses rules — so THIS FILE is now
// the thing standing between the database and arbitrary content. Nothing that
// isn't a pair of integers from the fixed word lists can become an event name.
//
// It imports the very same js/words.js the UI uses, so the list lengths can
// never drift apart the way the hard-coded VIBES=30 / ACTIVITIES=86 /
// FORMATS=26 constants in the rules could.
// ============================================================================

import { isValidCombo } from '../../js/words.js';
import { geohash4 } from '../../js/geo.js';
import { fail } from './http.js';
import { MAX_EVENT_MS, MIN_EVENT_MS } from './config.js';

const int = (v) => (typeof v === 'number' && Number.isInteger(v) ? v : NaN);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/** Firestore auto-ids, and the demo/seed ids the client may still hold. */
export function assertEventId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw fail(400, 'bad_request', 'Bad event id.');
  }
  return id;
}

/**
 * Turn an untrusted body into exactly the nine fields an event document may
 * contain. Anything else the caller sent is dropped on the floor.
 */
export function cleanEvent(body) {
  const a = int(body.a);
  const b = int(body.b);
  const c = int(body.c);
  if (!isValidCombo(a, b, c)) {
    throw fail(400, 'bad_words', 'Event names must be 2–3 words from the built-in lists.');
  }

  const lat = num(body.lat);
  const lng = num(body.lng);
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
    throw fail(400, 'bad_request', 'That location is not on Earth.');
  }

  const durationMs = num(body.durationMs);
  if (!(durationMs >= MIN_EVENT_MS && durationMs <= MAX_EVENT_MS)) {
    throw fail(400, 'bad_duration', 'Events last between 5 minutes and 7 days.');
  }

  return {
    a, b, c, lat, lng,
    // Computed here, never taken from the client. The old rules could not
    // recompute a geohash, so a mismatched `g4` was a real way to hide events
    // from the viewport query — that hole closes by simply not asking.
    g4: geohash4(lat, lng),
    durationMs: Math.round(durationMs),
  };
}
