// ============================================================================
// POST /api/create — put an event on the map.
//
// Order matters:
//   1. shape check   (free — never spend anything on a malformed body)
//   2. Turnstile     (costs the caller a solved challenge before we touch
//                     Firestore, so a flood can't burn the free write quota)
//   3. rate limit    (keyed on the network, so incognito changes nothing)
//   4. write
//
// Returns { id, secret }. The secret is shown to nobody and stored only in the
// creator's browser; only its hash reaches the database, in a subdocument no
// client can read. It is what makes "Remove this event" possible without
// accounts — and without stamping a stable identifier onto the public event
// doc, which would let a scraper link every event one person ever created.
// ============================================================================

import { handler, fail } from './_lib/http.js';
import { db, FieldValue, Timestamp } from './_lib/firestore.js';
import { assertHuman } from './_lib/turnstile.js';
import { claimSlot } from './_lib/limits.js';
import { cleanEvent } from './_lib/validate.js';
import { visitorHash, clientIp, newOwnerSecret, hashOwnerSecret } from './_lib/identity.js';
import { CREATE_COOLDOWN_MS, CREATE_MAX_PER_WINDOW, CREATE_WINDOW_MS } from './_lib/config.js';

export default handler(async (req, body) => {
  const ev = cleanEvent(body);

  await assertHuman(body.token, { action: 'create', remoteip: clientIp(req) });

  const who = visitorHash(req);
  const store = db();
  await claimSlot(
    store,
    `c:${who}`,
    { max: CREATE_MAX_PER_WINDOW, windowMs: CREATE_WINDOW_MS, cooldownMs: CREATE_COOLDOWN_MS },
    "You've put up a few events already — give it a little while.",
  );

  const expiresAt = Timestamp.fromMillis(Date.now() + ev.durationMs);
  const evRef = store.collection('events').doc();
  const secret = newOwnerSecret();

  const batch = store.batch();
  batch.set(evRef, {
    a: ev.a, b: ev.b, c: ev.c,
    lat: ev.lat, lng: ev.lng,
    g4: ev.g4,
    joins: 0,
    created: FieldValue.serverTimestamp(),
    expiresAt,
  });
  batch.set(evRef.collection('priv').doc('owner'), {
    secretHash: hashOwnerSecret(secret),
    // Its own TTL stamp: deleting the parent event does NOT delete its
    // subcollections, so without this the priv docs would outlive the map.
    expiresAt,
  });

  try {
    await batch.commit();
  } catch (err) {
    console.error('[api/create] write failed:', err);
    throw fail(503, 'write_failed', 'Could not save the event — please try again.');
  }

  return { id: evRef.id, secret, expiresAt: expiresAt.toMillis() };
});
