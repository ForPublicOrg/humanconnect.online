// ============================================================================
// Server-side limits. These are the REAL ones — the client has its own
// cooldown in js/config.js, but that is politeness (instant feedback), not
// enforcement: anything a browser stores, a browser can clear.
//
// Everything here is keyed on identity the *server* derives (see identity.js),
// so a fresh incognito window looks exactly like the window it was opened from.
// ============================================================================

// ---------------------------------------------------------------------------
// Creating events
// ---------------------------------------------------------------------------

// Back-to-back creates from one network. Mirrors CREATE_COOLDOWN_MS in
// js/config.js — keep the two roughly in step so the UI never promises a
// create the API is about to refuse.
export const CREATE_COOLDOWN_MS = 2 * 60 * 1000;

// Rolling-window cap. A genuine organiser puts up a handful of plans a day;
// past that it is a grid of junk, which is exactly what we are stopping.
export const CREATE_MAX_PER_WINDOW = 6;
export const CREATE_WINDOW_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Joining events
// ---------------------------------------------------------------------------

// How many joins one network may contribute to ONE event.
//
// This is the number that decides the incognito exploit, and it is a genuine
// trade-off with no clean answer on a no-accounts site:
//   - too low  → a household, hostel, or office on one connection can't all
//                join, and Indian mobile carriers put *thousands* of unrelated
//                users behind a single CGNAT address;
//   - too high → the exploit survives, just slower.
// 8 keeps real shared connections working while turning "unlimited" into a
// rounding error on a counter that is social proof, not an audited number.
export const JOIN_MAX_PER_NETWORK_PER_EVENT = 8;

// Total joins one network may make across ALL events per window — stops
// someone grinding +8 across every pin on the map.
export const JOIN_MAX_PER_WINDOW = 40;
export const JOIN_WINDOW_MS = 24 * 60 * 60 * 1000;

// Devices remembered per (network, event) pair. Bounded so a shared address
// can't grow the document without limit.
export const MAX_DEVICES_PER_JOINER_DOC = 16;

// ---------------------------------------------------------------------------
// Event shape
// ---------------------------------------------------------------------------

// Hard ceiling on how long an event may sit on the map. Must stay >= the
// longest option in DURATIONS (js/config.js).
export const MAX_EVENT_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_EVENT_MS = 5 * 60 * 1000;

// How long a rate-limit document outlives its window before Firestore TTL
// sweeps it up.
export const LIMIT_DOC_GRACE_MS = 60 * 60 * 1000;
