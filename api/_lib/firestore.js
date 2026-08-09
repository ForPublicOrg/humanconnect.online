// ============================================================================
// Firestore, from the server side.
//
// The Admin SDK authenticates with a service account and therefore BYPASSES
// firestore.rules entirely. That is deliberate: the rules now deny every
// client write, so this module is the only door into the database, and
// validate.js is where the word-index safety model is enforced. Treat any
// change here with the same care the rules used to get.
//
// The service account key is a real credential — it lives only in the Vercel
// environment, never in the repo.
// ============================================================================

import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { fail } from './http.js';

export { FieldValue, Timestamp };

function credentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.error(
      '[api] FIREBASE_SERVICE_ACCOUNT is not set — the write API cannot reach ' +
      'Firestore. Paste the service-account JSON (Firebase console → Project ' +
      'settings → Service accounts → Generate new private key) into that ' +
      'Vercel environment variable.',
    );
    throw fail(503, 'server_unconfigured', 'The server is not connected to the database.');
  }
  let json;
  try {
    // Accept raw JSON or base64 — pasting multi-line JSON into a dashboard
    // field mangles newlines often enough to be worth supporting both.
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    json = JSON.parse(text);
  } catch {
    throw fail(503, 'server_unconfigured', 'The service-account credential is not valid JSON.');
  }
  // Dashboards routinely store the PEM with literal \n sequences.
  if (typeof json.private_key === 'string') json.private_key = json.private_key.replace(/\\n/g, '\n');
  return json;
}

let cached = null;

/** The shared Firestore handle. Warm invocations reuse the same app. */
export function db() {
  if (cached) return cached;
  const svc = credentials();
  const app = getApps().length
    ? getApps()[0]
    : initializeApp({ credential: cert(svc), projectId: svc.project_id });
  cached = getFirestore(app);
  // Undefined fields are a bug, not a shrug — surface them instead of writing
  // half a document.
  cached.settings({ ignoreUndefinedProperties: false });
  return cached;
}
