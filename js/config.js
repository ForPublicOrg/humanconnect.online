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

// Initial map view when nothing is saved and geolocation is unavailable.
export const DEFAULT_VIEW = { lat: 22.5, lng: 78.9, zoom: 5 }; // India
