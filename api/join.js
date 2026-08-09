// ============================================================================
// POST /api/join — count one person in.
//
// This is the endpoint the incognito trick used to beat. The counter no longer
// takes the browser's word for anything:
//
//   - the *device* id makes a repeat join idempotent for an honest visitor who
//     cleared storage or opened the link on a second tab;
//   - the *network* hash is what a new incognito window cannot change, and it
//     caps how many joins one connection can add to a single event;
//   - Turnstile makes each attempt cost a solved challenge.
//
// A shared address (a hostel, an office, an Indian mobile carrier's CGNAT) is
// the reason the per-event cap is 8 rather than 1 — see api/_lib/config.js.
// ============================================================================

import { handler, fail } from './_lib/http.js';
import { db, FieldValue } from './_lib/firestore.js';
import { assertHuman } from './_lib/turnstile.js';
import { claimSlot } from './_lib/limits.js';
import { assertEventId } from './_lib/validate.js';
import { visitorHash, deviceHash, clientIp } from './_lib/identity.js';
import {
  JOIN_MAX_PER_NETWORK_PER_EVENT, JOIN_MAX_PER_WINDOW, JOIN_WINDOW_MS,
  MAX_DEVICES_PER_JOINER_DOC,
} from './_lib/config.js';

export default handler(async (req, body) => {
  const id = assertEventId(body.id);

  await assertHuman(body.token, { action: 'join', remoteip: clientIp(req) });

  const who = visitorHash(req);
  const device = deviceHash(body.device);
  const store = db();

  await claimSlot(
    store,
    `j:${who}`,
    { max: JOIN_MAX_PER_WINDOW, windowMs: JOIN_WINDOW_MS },
    "You've joined a lot of events today — try again tomorrow.",
  );

  const evRef = store.collection('events').doc(id);
  const joinerRef = evRef.collection('joiners').doc(who);

  return store.runTransaction(async (tx) => {
    const [evSnap, joinerSnap] = await tx.getAll(evRef, joinerRef);
    if (!evSnap.exists) throw fail(404, 'not-found', 'This event is gone.');

    const ev = evSnap.data();
    const expiresAt = ev.expiresAt?.toMillis?.() ?? 0;
    if (expiresAt <= Date.now()) throw fail(410, 'not-found', 'This event has ended.');

    const devices = Array.isArray(joinerSnap.data()?.d) ? joinerSnap.data().d : [];

    // Already counted from this device: succeed without moving the number.
    // The UI treats this exactly like a fresh join, so a double tap or a
    // re-opened link never double-counts and never shows an error either.
    if (devices.includes(device)) return { already: true, joins: ev.joins };

    if (devices.length >= JOIN_MAX_PER_NETWORK_PER_EVENT) {
      throw fail(429, 'network_cap',
        'This connection has already joined this event as many times as we allow.');
    }

    tx.set(joinerRef, {
      d: [...devices, device].slice(-MAX_DEVICES_PER_JOINER_DOC),
      n: devices.length + 1,
      // Subcollections survive their parent's TTL deletion, so stamp our own.
      expiresAt: ev.expiresAt,
    });
    tx.update(evRef, { joins: FieldValue.increment(1) });

    return { already: false, joins: (typeof ev.joins === 'number' ? ev.joins : 0) + 1 };
  });
});
