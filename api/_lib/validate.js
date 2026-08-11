// ============================================================================
// The legal-safety model, enforced server-side.
//
// This used to live in firestore.rules. It moved here the moment writes moved
// behind the API, because the Admin SDK bypasses rules — so THIS FILE is now
// the thing standing between the database and arbitrary content. Nothing that
// isn't a pair of integers from the fixed word lists can become an event name.
//
// It imports the very same js/words.js the UI uses, so the two can never drift
// apart the way the hard-coded VIBES / ACTIVITIES / FORMATS list lengths in the
// rules could — and that now covers the help-request lists too.
// ============================================================================

import { isValidCombo, isKind, isRetiredWord, KIND_EVENT } from '../../js/words.js';
import { geohash4 } from '../../js/geo.js';
import { fail } from './http.js';
import { MAX_EVENT_MS, MIN_EVENT_MS } from './config.js';

const int = (v) => (typeof v === 'number' && Number.isInteger(v) ? v : NaN);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

/**
 * `k` as it arrives from a client or comes back off a stored document.
 *
 * Absent means a plan, and has to keep meaning that forever: every event
 * written before help requests existed has no `k` at all, and /api/create
 * still omits the field for plans so those documents stay byte-identical.
 */
export const kindOf = (v) => (v == null ? KIND_EVENT : v);

/** Firestore auto-ids, and the demo/seed ids the client may still hold. */
export function assertEventId(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw fail(400, 'bad_request', 'Bad event id.');
  }
  return id;
}

/** Words + stay: the part of a pin's shape shared by create and update. */
function cleanWordsAndStay(body) {
  // Which word lists {a,b,c} index into. Validated before the indices, because
  // "is 42 a real activity?" has no answer until we know it isn't a need.
  const kind = kindOf(body.k);
  if (!isKind(kind)) {
    throw fail(400, 'bad_kind', 'That is not something this map can hold.');
  }

  const a = int(body.a);
  const b = int(body.b);
  const c = int(body.c);
  if (!isValidCombo(kind, a, b, c)) {
    throw fail(400, 'bad_words', 'Names must be 2–3 words from the built-in lists.');
  }

  const duration = num(body.durationMs);
  if (!(duration >= MIN_EVENT_MS && duration <= MAX_EVENT_MS)) {
    throw fail(400, 'bad_duration', 'Pins last between 5 minutes and 7 days.');
  }

  return { kind, a, b, c, durationMs: Math.round(duration) };
}

/**
 * Turn an untrusted body into exactly the fields an event document may
 * contain. Anything else the caller sent is dropped on the floor.
 */
export function cleanEvent(body) {
  const fields = cleanWordsAndStay(body);
  const { durationMs } = fields;

  // NEW pins may not use a retired word — where a typed variant exists, the
  // type is required, because it decides who can help (blood group, fuel).
  // Only here, not in cleanEventPatch: an EDIT of a pin that legitimately
  // carries the retired word re-sends it, and saving a new stay must not be
  // refused over a word the pin already wears.
  if (isRetiredWord(fields.kind, fields.b)) {
    throw fail(400, 'bad_words', 'That one needs the exact type — pick it from the list.');
  }

  const lat = num(body.lat);
  const lng = num(body.lng);
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
    throw fail(400, 'bad_request', 'That location is not on Earth.');
  }

  // When the plan actually begins. Optional — most events start the moment
  // they go up — and sent as an OFFSET from now rather than a timestamp, so a
  // device whose clock is minutes off still gets the time its owner picked
  // (see js/app.js). Bounded by the duration in both directions: an event may
  // not begin before it exists, nor after it has already left the map.
  let startInMs = null;
  if (body.startInMs != null) {
    const start = num(body.startInMs);
    if (!(start >= 0 && start <= durationMs)) {
      throw fail(400, 'bad_start', 'An event cannot start after it leaves the map.');
    }
    startInMs = Math.round(start);
  }

  return {
    ...fields, lat, lng,
    // Computed here, never taken from the client. The old rules could not
    // recompute a geohash, so a mismatched `g4` was a real way to hide events
    // from the viewport query — that hole closes by simply not asking.
    g4: geohash4(lat, lng),
    startInMs,
  };
}

/**
 * The editable half of an event, for /api/update. Location is absent on
 * purpose — the place IS the event; moving the pin under people who already
 * joined would make it a lie. startInMs is tri-state: absent = keep the
 * current start time, null = clear it, a number = new offset from now.
 * Whether the result still fits inside the event's ORIGINAL window is checked
 * in api/update.js, where the creation time is known.
 *
 * `kind` comes back out for the same reason the location doesn't go in: it is
 * not editable. api/update.js compares it to the stored one and refuses a
 * mismatch, so a plan can never turn into a help request under the people who
 * already said they were coming.
 */
export function cleanEventPatch(body) {
  const fields = cleanWordsAndStay(body);

  let startInMs; // undefined = keep whatever the event already has
  if (body.startInMs === null) {
    startInMs = null;
  } else if (body.startInMs !== undefined) {
    const start = num(body.startInMs);
    if (!(start >= 0 && start <= fields.durationMs)) {
      throw fail(400, 'bad_start', 'An event cannot start after it leaves the map.');
    }
    startInMs = Math.round(start);
  }

  return { ...fields, startInMs };
}
