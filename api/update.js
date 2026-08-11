// ============================================================================
// POST /api/update — the creator changes their own event.
//
// Ownership works exactly like /api/remove: the proof is the secret handed
// back by /api/create, compared in constant time against the hash in a
// subdocument no client can read. No Turnstile — holding the secret is
// stronger proof than a challenge — but unlike remove an edit WRITES content,
// so it gets its own modest rate limit.
//
// The one rule that matters: durationMs is the TOTAL time on the map, and the
// 7-day ceiling stays anchored at the moment the event was FIRST placed.
// Editing never restarts the clock — changing "2 days" to "7 days" buys the
// five days that were left, not seven more.
//
// What an edit may NOT touch: the location (the place is the event) and the
// kind (a plan may not become a help request). Both would rewrite what the
// people who already joined actually agreed to.
// ============================================================================

import { handler, fail } from './_lib/http.js';
import { db, FieldValue, Timestamp } from './_lib/firestore.js';
import { claimSlot } from './_lib/limits.js';
import { assertEventId, cleanEventPatch, kindOf } from './_lib/validate.js';
import { visitorHash, hashOwnerSecret, secretMatches } from './_lib/identity.js';
import { UPDATE_COOLDOWN_MS, UPDATE_MAX_PER_WINDOW, UPDATE_WINDOW_MS } from './_lib/config.js';

export default handler(async (req, body) => {
  const id = assertEventId(body.id);
  const secret = body.secret;
  if (typeof secret !== 'string' || !secret) {
    throw fail(403, 'not_owner', 'Only the creator can edit an event.');
  }
  const patch = cleanEventPatch(body);

  const store = db();
  await claimSlot(
    store,
    `u:${visitorHash(req)}`,
    { max: UPDATE_MAX_PER_WINDOW, windowMs: UPDATE_WINDOW_MS, cooldownMs: UPDATE_COOLDOWN_MS },
    "You've been editing a lot — give it a moment.",
  );

  const evRef = store.collection('events').doc(id);
  const ownerRef = evRef.collection('priv').doc('owner');

  return store.runTransaction(async (tx) => {
    const [evSnap, ownerSnap] = await tx.getAll(evRef, ownerRef);
    if (!evSnap.exists) throw fail(404, 'not-found', 'This event is gone.');

    const stored = ownerSnap.exists ? ownerSnap.data()?.secretHash : null;
    if (typeof stored !== 'string' || !secretMatches(stored, hashOwnerSecret(secret))) {
      throw fail(403, 'not_owner', 'Only the creator can edit an event.');
    }

    const ev = evSnap.data();

    // The kind is not editable, and this is where that is enforced. The words
    // were validated against the kind the CALLER sent; if that isn't the kind
    // the document actually is, those indices mean something else entirely —
    // and a plan turning into a help request (or back) under the people who
    // already joined it would be a lie of the same sort as moving the pin.
    if (kindOf(ev.k) !== patch.kind) {
      throw fail(409, 'kind_mismatch', 'A plan cannot become a request, or the other way round.');
    }

    const createdAt = ev.created?.toMillis?.();
    // Every event /api/create ever wrote has this stamp; its absence means
    // something predating the API, which also has no secret to get here with.
    if (typeof createdAt !== 'number') {
      throw fail(409, 'not_editable', 'This event cannot be edited.');
    }

    const now = Date.now();
    const expiresAtMs = createdAt + patch.durationMs;
    // A stay the event has already outlived would expire it on the spot —
    // that's what Remove is for.
    if (expiresAtMs <= now) {
      throw fail(400, 'bad_duration', 'The event has already been up longer than that.');
    }

    let startAtMs;
    if (patch.startInMs === undefined) startAtMs = ev.startAt?.toMillis?.() ?? null;
    else if (patch.startInMs === null) startAtMs = null;
    else startAtMs = now + patch.startInMs;

    // The invariant every reader assumes: nothing on the map is scheduled for
    // after it has gone. A KEPT time stranded by a shorter stay is quietly
    // cleared (mirroring the create sheet); an explicitly SENT one is refused.
    if (startAtMs != null && startAtMs > expiresAtMs) {
      if (patch.startInMs === undefined) startAtMs = null;
      else throw fail(400, 'bad_start', 'An event cannot start after it leaves the map.');
    }

    const expiresAt = Timestamp.fromMillis(expiresAtMs);
    tx.update(evRef, {
      a: patch.a, b: patch.b, c: patch.c,
      startAt: startAtMs == null ? FieldValue.delete() : Timestamp.fromMillis(startAtMs),
      expiresAt,
    });
    // Move the ownership doc's own TTL stamp with the event, or extending a
    // stay would let Firestore sweep the secret's hash while the event is
    // still up — silently taking Edit and Remove away from its creator.
    //
    // Joiner docs are deliberately NOT re-stamped: that could be 400 writes
    // per edit. Worst case, extending a stay lets an already-swept network
    // re-join late — a few counts on a number that is social proof, not an
    // audited total (see api/_lib/config.js).
    tx.update(ownerRef, { expiresAt });

    return { expiresAt: expiresAtMs, startAt: startAtMs };
  });
});
