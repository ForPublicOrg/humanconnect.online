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

  const form = new URLSearchParams({ secret, response: token });
  // remoteip is optional and only ever sent to Cloudflare for this check.
  if (remoteip) form.set('remoteip', remoteip);

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
