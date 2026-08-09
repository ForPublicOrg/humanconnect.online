// ============================================================================
// Tiny HTTP helpers shared by the three write endpoints.
//
// Responses are always JSON of the shape { error, message } on failure, so
// js/store.js can turn a code into a human sentence without parsing prose.
// ============================================================================

/** An error carrying the HTTP status and machine-readable code to return. */
export class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra || null;
  }
}

export const fail = (status, code, message, extra) => new ApiError(status, code, message, extra);

export function send(res, status, body) {
  res.status(status);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  // Never let a CDN or browser cache a mutation's answer.
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

/**
 * Vercel parses JSON bodies for us, but only when the content-type says so —
 * parse defensively rather than trusting the caller to set the header.
 */
export function readBody(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  const raw = Buffer.isBuffer(b) ? b.toString('utf8') : typeof b === 'string' ? b : '';
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw fail(400, 'bad_request', 'Body must be JSON.'); }
}

/**
 * Same-origin gate. Browsers always attach `Origin` to a cross-origin POST
 * (and to same-origin fetch POSTs too), so comparing it to the host we were
 * reached on cheaply rejects other sites driving this API with a visitor's
 * connection. It is not the real defence — Turnstile is — but it costs
 * nothing and it keeps the endpoints from being a free write proxy.
 */
export function assertSameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!origin || !host) throw fail(403, 'forbidden', 'Missing origin.');
  let originHost;
  try { originHost = new URL(origin).host; } catch { throw fail(403, 'forbidden', 'Bad origin.'); }
  if (originHost !== host) throw fail(403, 'forbidden', 'Cross-origin requests are not allowed.');
}

/**
 * Wraps a handler so every endpoint gets: POST-only, same-origin, JSON body,
 * and uniform error mapping. Unexpected throws become a 500 with no internals
 * leaked to the client (they go to the function log instead).
 */
export function handler(fn) {
  return async (req, res) => {
    try {
      if (req.method === 'OPTIONS') { res.status(204).end(); return; }
      if (req.method !== 'POST') throw fail(405, 'method_not_allowed', 'Use POST.');
      assertSameOrigin(req);
      const out = await fn(req, readBody(req));
      send(res, 200, { ok: true, ...(out || {}) });
    } catch (err) {
      if (err instanceof ApiError) {
        send(res, err.status, { ok: false, error: err.code, message: err.message, ...(err.extra || {}) });
        return;
      }
      console.error('[api] unhandled error:', err);
      send(res, 500, { ok: false, error: 'server_error', message: 'Something went wrong.' });
    }
  };
}
