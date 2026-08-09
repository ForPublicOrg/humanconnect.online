// ============================================================================
// Rate limiting on top of Firestore.
//
// No Redis, no extra service, no bill: one small document per identity per
// bucket, swept up by the same TTL mechanism that deletes expired events. Each
// check is a single transaction (one read + one write) — cheap next to the
// Turnstile round trip that precedes it.
// ============================================================================

import { Timestamp } from './firestore.js';
import { fail } from './http.js';
import { LIMIT_DOC_GRACE_MS } from './config.js';

/**
 * Claim one slot in a fixed window, optionally behind a cooldown.
 *
 * Throws a 429 with `retryAfterMs` when the caller has to wait — the client
 * turns that straight into "you can create another in 47s".
 *
 * @param {string} key    bucket id, already opaque (e.g. `c:<visitorHash>`)
 * @param {object} rules  { max, windowMs, cooldownMs? }
 */
export async function claimSlot(store, key, { max, windowMs, cooldownMs = 0 }, message) {
  const ref = store.collection('limits').doc(key);
  const verdict = await store.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const prev = snap.exists ? snap.data() : null;

    // A window that has run its course starts over from this request.
    const fresh = !prev || typeof prev.windowStart !== 'number' || now - prev.windowStart >= windowMs;
    const windowStart = fresh ? now : prev.windowStart;
    const used = fresh ? 0 : (typeof prev.n === 'number' ? prev.n : 0);

    if (cooldownMs && prev?.last && now - prev.last < cooldownMs) {
      return { ok: false, reason: 'cooldown', retryAfterMs: cooldownMs - (now - prev.last) };
    }
    if (used >= max) {
      return { ok: false, reason: 'quota', retryAfterMs: windowStart + windowMs - now };
    }

    tx.set(ref, {
      n: used + 1,
      windowStart,
      last: now,
      // TTL field — see README, the `limits` collection group needs a policy.
      expiresAt: Timestamp.fromMillis(windowStart + windowMs + LIMIT_DOC_GRACE_MS),
    });
    return { ok: true };
  });

  if (!verdict.ok) {
    throw fail(429, 'rate_limited', message, {
      retryAfterMs: Math.max(0, Math.ceil(verdict.retryAfterMs)),
      reason: verdict.reason,
    });
  }
}
