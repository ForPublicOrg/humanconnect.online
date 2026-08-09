// ============================================================================
// Who is asking — derived on the SERVER, never sent by the client.
//
// This is the whole point of moving writes off the browser. A visitor's
// localStorage is theirs to clear (that is what an incognito window does in
// one keystroke), so any limit keyed on it is a suggestion. The network the
// request arrives from is not something the page can rewrite, so that is what
// the limits are keyed on.
//
// PRIVACY: the raw address is used for the length of one request and never
// stored. What lands in Firestore is an HMAC of it under a server-only salt —
// a stable opaque handle, not reversible into an IP, and useless to anyone who
// reads the database without the salt.
// ============================================================================

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

let warned = false;
function salt() {
  const s = process.env.IDENTITY_SALT;
  if (s) return s;
  if (!warned) {
    warned = true;
    console.warn(
      '[api] IDENTITY_SALT is not set — visitor hashes are computed with a ' +
      'public constant, so anyone with the database could test a guessed IP ' +
      'against them. Set IDENTITY_SALT to a long random string in Vercel.',
    );
  }
  return 'humanconnect-dev-salt';
}

const hmac = (scope, value) =>
  createHmac('sha256', salt()).update(`${scope}:${value}`).digest('hex');

/**
 * The visitor's address as Vercel saw it.
 *
 * `x-vercel-forwarded-for` is written by the platform and cannot be spoofed by
 * the caller; plain `x-forwarded-for` can carry client-supplied entries ahead
 * of the real one, so it is the last resort and we take only its first hop.
 */
export function clientIp(req) {
  const h = req.headers;
  const direct = h['x-vercel-forwarded-for'] || h['x-real-ip'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const xff = h['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff || '').split(',')[0].trim();
  return first || req.socket?.remoteAddress || '';
}

/**
 * Collapse an address to the unit that identifies a connection.
 *
 * IPv6 clients (most Indian mobile networks) get a fresh address from their
 * /64 prefix routinely — often per connection — so hashing the full address
 * would hand every phone an endless supply of "new" identities. The /64 is the
 * subnet a single subscriber is delegated, so that is the stable part.
 */
export function normalizeIp(ip) {
  if (!ip) return '';
  let v = ip.trim().toLowerCase();
  if (v.startsWith('[')) v = v.slice(1, v.indexOf(']') > 0 ? v.indexOf(']') : undefined);
  // ::ffff:1.2.3.4 — an IPv4 address wearing an IPv6 coat.
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  // 1.2.3.4:56789 — a port would make every TCP connection a "new" visitor,
  // which is the entire limit bypassed. Drop it before the colon fools the
  // IPv6 branch below.
  const ported = v.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ported) return ported[1];
  if (!v.includes(':')) return v.split('%')[0];

  // IPv6: expand, then keep the first four groups (the /64).
  const zoneless = v.split('%')[0];
  const [head, tail = ''] = zoneless.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const fill = 8 - headParts.length - tailParts.length;
  const full = zoneless.includes('::')
    ? [...headParts, ...Array(Math.max(fill, 0)).fill('0'), ...tailParts]
    : zoneless.split(':');
  return full.slice(0, 4).map((g) => (g || '0').padStart(4, '0')).join(':') + '::/64';
}

/** Opaque, stable handle for the network this request came from. */
export function visitorHash(req) {
  const ip = normalizeIp(clientIp(req));
  // No address at all (shouldn't happen behind Vercel): fall back to a single
  // shared bucket rather than handing out unlimited anonymous identities.
  return hmac('ip', ip || 'unknown').slice(0, 40);
}

/**
 * Per-browser handle, supplied by the client. Deliberately weak on its own —
 * a new incognito window generates a new one — but it lets several real
 * devices behind one shared address each be counted once, which a purely
 * network-keyed limit could not do without locking out whole buildings.
 */
export function deviceHash(raw) {
  const v = typeof raw === 'string' && raw.length >= 8 && raw.length <= 128 ? raw : 'anonymous';
  return hmac('dev', v).slice(0, 24);
}

/** Secret handed to the creator once, so only they can remove their event. */
export const newOwnerSecret = () => randomBytes(24).toString('base64url');
export const hashOwnerSecret = (secret) => hmac('own', secret);

/** Constant-time compare of two hex digests. */
export function secretMatches(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
