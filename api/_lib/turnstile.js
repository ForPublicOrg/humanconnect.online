// ============================================================================
// Cloudflare Turnstile verification.
//
// The widget in the browser proves nothing by itself — the token it produces
// is only worth something once Cloudflare confirms it here, server-side, with
// the secret key. A token is single-use and expires in ~5 minutes, so a
// scripted flood has to solve a fresh challenge per write instead of replaying
// one.
//
// This layer stops *automation*. It does not stop a determined human with an
// incognito window — that is what the identity-keyed limits in limits.js are
// for. Both are needed; neither replaces the other.
// ============================================================================

import { fail } from './http.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Throws an ApiError unless the token is valid for `action`.
 * Fails CLOSED: with no secret configured, writes are refused rather than
 * quietly waved through.
 */
export async function assertHuman(token, { action, remoteip }) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) {
    console.error(
      '[api] TURNSTILE_SECRET is not set — refusing writes. Set it in Vercel ' +
      '(Cloudflare dashboard → Turnstile → your widget → Secret Key).',
    );
    throw fail(503, 'verification_unavailable', 'Verification is not configured on the server.');
  }
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) {
    throw fail(400, 'verification_failed', 'Missing verification token.');
  }

  // .trim() is not cosmetic: pasting a key into a dashboard field very often
  // carries a trailing newline, and Cloudflare answers a whitespace-padded
  // secret with invalid-input-secret — which looks exactly like "this visitor
  // is a bot" unless you read the error codes.
  const form = new URLSearchParams({ secret: secret.trim(), response: token.trim() });

  // remoteip is OPTIONAL and off by default. Behind Vercel we may report a
  // different address than the one Cloudflare saw solve the challenge (v4 vs
  // v6, or a different edge hop), and a mismatch fails an otherwise perfectly
  // good token. Set TURNSTILE_SEND_REMOTEIP=1 only if you've confirmed the two
  // agree; the token is single-use and origin-checked either way.
  if (remoteip && process.env.TURNSTILE_SEND_REMOTEIP === '1') form.set('remoteip', remoteip);

  let data;
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(6000),
    });
    data = await res.json();
  } catch (err) {
    // Cloudflare unreachable. Still fail closed — a verification outage must
    // not become an open write endpoint — but say so honestly so the UI can
    // suggest "try again" rather than "you look like a bot".
    console.error('[api] Turnstile siteverify unreachable:', err);
    throw fail(503, 'verification_unavailable', 'Could not reach the verification service.');
  }

  if (!data?.success) {
    const codes = Array.isArray(data?.['error-codes']) ? data['error-codes'] : [];

    // Say WHY, in the function log. Collapsing every rejection into
    // "verification failed" made a misconfigured key indistinguishable from a
    // bot, which cost an afternoon once. The codes never reach the browser —
    // they'd tell an attacker which half of the setup to attack.
    const EXPLAIN = {
      'invalid-input-secret': 'TURNSTILE_SECRET is wrong, or is not the secret paired with this site key. Re-copy BOTH keys from the same widget.',
      'missing-input-secret': 'TURNSTILE_SECRET is empty.',
      'invalid-input-response': 'The token is malformed, or was minted by a DIFFERENT site key than this secret belongs to.',
      'missing-input-response': 'The client sent no token.',
      'bad-request': 'Malformed request to siteverify.',
      'timeout-or-duplicate': 'Token already spent or older than ~5 minutes.',
      'internal-error': 'Cloudflare-side error — retrying usually works.',
    };
    console.error(
      `[api] Turnstile rejected a token for action=${action}. ` +
      `error-codes=[${codes.join(', ')}]` +
      codes.map((c) => (EXPLAIN[c] ? `\n  → ${c}: ${EXPLAIN[c]}` : '')).join(''),
    );

    // An expired/already-spent token is the common honest case (a sheet left
    // open for ten minutes); tell the client so it can silently retry once.
    const stale = codes.includes('timeout-or-duplicate');
    throw fail(stale ? 409 : 403, stale ? 'verification_stale' : 'verification_failed',
      stale ? 'Verification expired — please try again.' : 'Verification failed.');
  }

  // Bind the token to the operation it was minted for, so a token obtained on
  // the join path can't be spent on the (more expensive) create path.
  if (action && data.action && data.action !== action) {
    throw fail(403, 'verification_failed', 'Verification was issued for a different action.');
  }
}
