// ============================================================================
// POST /api/remove — the creator takes their own event down early.
//
// Proof of ownership is the secret handed back by /api/create, which lives in
// the creator's localStorage and nowhere else. Only its hash is stored, in a
// subdocument no client can read, so possessing the database does not let you
// delete anyone's event — and the public event document still carries nothing
// that links one person's events to each other.
//
// No Turnstile here: holding the secret is already stronger proof than a
// challenge, and there is no abuse to gain (you can only delete your own).
// ============================================================================

import { handler, fail } from './_lib/http.js';
import { db } from './_lib/firestore.js';
import { assertEventId } from './_lib/validate.js';
import { hashOwnerSecret, secretMatches } from './_lib/identity.js';

// Joiner docs are bounded by the per-event join cap, so one batch clears any
// realistic event. Stragglers (an implausibly popular pin) are swept by TTL.
const MAX_JOINERS_TO_SWEEP = 400;

export default handler(async (req, body) => {
  const id = assertEventId(body.id);
  const secret = body.secret;
  if (typeof secret !== 'string' || !secret) {
    throw fail(403, 'not_owner', 'Only the creator can remove an event.');
  }

  const store = db();
  const evRef = store.collection('events').doc(id);
  const ownerRef = evRef.collection('priv').doc('owner');

  const ownerSnap = await ownerRef.get();
  const stored = ownerSnap.exists ? ownerSnap.data()?.secretHash : null;
  // Events created before server-side ownership existed have no secretHash;
  // nobody can remove those early, and they expire within a week regardless.
  if (typeof stored !== 'string' || !secretMatches(stored, hashOwnerSecret(secret))) {
    throw fail(403, 'not_owner', 'Only the creator can remove an event.');
  }

  const joiners = await evRef.collection('joiners').limit(MAX_JOINERS_TO_SWEEP).get();
  const batch = store.batch();
  joiners.forEach((d) => batch.delete(d.ref));
  batch.delete(ownerRef);
  batch.delete(evRef);
  await batch.commit();

  return {};
});
