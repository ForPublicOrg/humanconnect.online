// ============================================================================
// App configuration.
//
// The environment-specific values (Firebase keys, App Check, report email)
// live in js/env.js. That file is the committed demo default
// and is regenerated from Vercel environment variables at build time — so to
// configure production you set env vars in Vercel, not edit code here.
// While the Firebase keys are empty the site runs in DEMO MODE.
//
// The values below are product constants, safe to tune in code.
// ============================================================================

import { ENV } from './env.js?v=msmfhh75';
import { KIND_EVENT, KIND_HELP } from './words.js?v=msmfhh75';

export const firebaseConfig = {
  apiKey: ENV.FIREBASE_API_KEY,
  authDomain: ENV.FIREBASE_AUTH_DOMAIN ||
    (ENV.FIREBASE_PROJECT_ID ? `${ENV.FIREBASE_PROJECT_ID}.firebaseapp.com` : ''),
  projectId: ENV.FIREBASE_PROJECT_ID,
  appId: ENV.FIREBASE_APP_ID,
};

// Firebase App Check (STRONGLY recommended once live — blocks bots/scripts
// from reaching Firestore). Set APPCHECK_SITE_KEY (reCAPTCHA v3) in Vercel and
// enable "Enforce" for Firestore in the Firebase console. Two separate steps —
// see README → Abuse & attack protection.
export const appCheckSiteKey = ENV.APPCHECK_SITE_KEY;

// Cloudflare Turnstile (free). The site key is public; the matching SECRET
// key is a server-only env var read by api/_lib/turnstile.js. Every write goes
// through /api/*, and those endpoints refuse to run without the secret — so
// setting one half without the other means writes are off, not unprotected.
export const turnstileSiteKey = ENV.TURNSTILE_SITE_KEY;

// Where the "Report" button sends reports (any inbox you check).
export const REPORT_EMAIL = ENV.REPORT_EMAIL || 'vikas070696@gmail.com';

// Maximum live events fetched onto the map at once.
export const MAX_EVENTS = 500;

// Cooldown between creating events (ms). This copy is for instant feedback
// only — the enforced one lives in api/_lib/config.js, where clearing browser
// storage can't reach it. Keep the two in step.
export const CREATE_COOLDOWN_MS = 2 * 60 * 1000;

// Event duration choices. Max 7 days — enforced again by security rules.
export const DURATIONS = [
  { label: '1h',  ms: 1 * 3600e3 },
  { label: '3h',  ms: 3 * 3600e3 },
  { label: '6h',  ms: 6 * 3600e3 },
  { label: '12h', ms: 12 * 3600e3 },
  { label: '1 day',  ms: 24 * 3600e3 },
  { label: '2 days', ms: 48 * 3600e3 },
  { label: '3 days', ms: 72 * 3600e3 },
  { label: '1 week', ms: 7 * 24 * 3600e3 },
];

// Quick start times, as offsets from the moment they're tapped. Only the ones
// that still land inside the chosen duration are offered, so the chip row
// teaches the rule the API enforces: an event may not begin after it has left
// the map. Anything these don't cover goes through the exact picker.
export const START_PRESETS = [
  { label: 'In 30 min', ms: 30 * 60e3 },
  { label: 'In 1h',     ms: 1 * 3600e3 },
  { label: 'In 2h',     ms: 2 * 3600e3 },
  { label: 'In 4h',     ms: 4 * 3600e3 },
  { label: 'In 12h',    ms: 12 * 3600e3 },
  { label: 'In 1 day',  ms: 24 * 3600e3 },
  { label: 'In 3 days', ms: 3 * 24 * 3600e3 },
];

// Initial map view when nothing is saved and geolocation is unavailable.
export const DEFAULT_VIEW = { lat: 22.5, lng: 78.9, zoom: 5 }; // India

// ---------------------------------------------------------------------------
// The two kinds of pin, in words.
//
// A plan invites people TO something; a help request asks people FOR something.
// Every mechanic is shared — a name from a fixed word list, a stay on the map,
// a counter that grows the pin, a creator who can edit or take it down — and
// the ONLY difference is the language around them. All of that language lives
// here, so the two can never end up half-translated: nothing in js/app.js says
// "event" or "request" in a string of its own.
//
// js/words.js is imported by api/_lib/validate.js and must stay data-only;
// this file is client-side, which is why the copy lives here and not there.
// ---------------------------------------------------------------------------
const COPY = {
  [KIND_EVENT]: {
    noun: 'event',
    sheetLabel: 'Create an event',

    // Composer
    previewEmpty: 'Pick an activity…',
    hintPick: 'Choose one activity, then add a vibe or a format.',
    hintOk: 'Looks good — set how long it stays on the map.',
    hintMore: 'Add a vibe or a format to complete the name (2–3 words).',
    labelMain: 'Activity', optMain: '· required',
    labelFirst: 'Vibe', optFirst: '· optional first word',
    labelLast: 'Format', optLast: '· optional last word',
    labelStart: 'Starts', optStart: '· optional, within that time',
    searchPlaceholder: 'Search activities…',
    noMatch: 'No matching activity',
    cta: 'Put it on the map',
    ctaBusy: 'Putting it on the map…',
    created: 'Your event is live 💚',

    // One-shot notices for a start time the sheet had to move (see renderStarts)
    startClamped: "An event can't start after it leaves the map — moved to its last moment.",
    startPassed: 'That time has passed — starting right now.',
    startCleared: (stay) => `Start time cleared — ${stay} on the map doesn't reach it.`,

    // Detail sheet
    join: 'Join',
    joined: "You're in ✓",
    joins: (n) => (n === 0 ? 'Be the first to join' : n === 1 ? '1 person joining' : `${n} people joining`),
    starts: (when) => `Starts ${when}`,
    started: (when) => `Started ${when}`,
    ends: (left) => `Ends in ${left}`,
    mineTag: 'Your event',
    report: 'Report this event',
    edit: 'Edit this event',
    remove: 'Remove this event',
    removeArmed: 'Tap again to remove',
    shareText: (title) => `${title} — join me on humanconnect`,

    // Toasts / errors
    gone: 'This event is gone',
    updated: 'Event updated',
    removed: 'Event removed',
    createFailed: 'Could not create the event — check your connection',
    joinFailed: 'Could not join — try again',
    saveFailed: "Couldn't save the changes — try again",
    removeFailed: "Couldn't remove it — try again",
    networkCap: 'This connection has already joined this event.',
  },

  [KIND_HELP]: {
    noun: 'request',
    sheetLabel: 'Ask for help',

    previewEmpty: 'Pick what you need…',
    hintPick: 'Choose what you need, then say how urgent it is.',
    hintOk: 'Looks good — set how long the request stays up.',
    hintMore: 'Add an urgency or a wording to complete it (2–3 words).',
    labelMain: 'What do you need?', optMain: '· required',
    labelFirst: 'Urgency', optFirst: '· optional first word',
    labelLast: 'Wording', optLast: '· optional last word',
    labelStart: 'Needed', optStart: '· optional, within that time',
    searchPlaceholder: 'Search what you need…',
    noMatch: 'No matching need',
    cta: 'Ask for help',
    ctaBusy: 'Posting your request…',
    created: 'Your request is on the map 🙏',

    startClamped: "A request can't be needed after it leaves the map — moved to its last moment.",
    startPassed: 'That time has passed — needed right now.',
    startCleared: (stay) => `Time cleared — ${stay} on the map doesn't reach it.`,

    joins: (n) => (n === 0 ? 'Be the first to help' : n === 1 ? '1 person coming' : `${n} people coming`),
    join: "I'm coming",
    joined: "You're coming ✓",
    starts: (when) => `Needed ${when}`,
    started: (when) => `Needed since ${when}`,
    ends: (left) => `Closes in ${left}`,
    mineTag: 'Your request',
    report: 'Report this request',
    edit: 'Edit this request',
    remove: 'Remove this request',
    removeArmed: 'Tap again to remove',
    shareText: (title) => `${title} — someone nearby needs help on humanconnect`,

    gone: 'This request is gone',
    updated: 'Request updated',
    removed: 'Request removed',
    createFailed: 'Could not post the request — check your connection',
    joinFailed: "Could not mark you as coming — try again",
    saveFailed: "Couldn't save the changes — try again",
    removeFailed: "Couldn't remove it — try again",
    networkCap: "This connection has already said it's coming.",
  },
};

/** Copy for a kind. Falls back to plans, which is what an unknown `k` renders as. */
export const kindCopy = (kind) => COPY[kind] ?? COPY[KIND_EVENT];
