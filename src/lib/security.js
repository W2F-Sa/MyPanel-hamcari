// Security middleware: hardened response headers, login rate-limiting and
// CSRF enforcement for state-changing requests.

import { getDb, now } from './db.js';
import { loadConfig } from '../config.js';
import { HttpError } from './http.js';
import { safeEqual } from './crypto.js';

// A strict CSP. The UI ships its own JS/CSS from the same origin, uses no
// inline event handlers, and only talks to its own API, so 'self' is enough.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
].join('; ');

export function applySecurityHeaders(ctx) {
  const h = ctx.res;
  h.setHeader('X-Content-Type-Options', 'nosniff');
  h.setHeader('X-Frame-Options', 'DENY');
  h.setHeader('Referrer-Policy', 'no-referrer');
  h.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  h.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  h.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  h.setHeader('Content-Security-Policy', CSP);
  h.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  h.setHeader('X-Robots-Tag', 'noindex, nofollow');
  // Never advertise the runtime
  h.removeHeader('X-Powered-By');
}

// ---- Login rate limiting (per scope+ip sliding window) ----

export function recordLoginAttempt(scope, ip) {
  getDb()
    .prepare('INSERT INTO login_attempts (scope, ip, created_at) VALUES (?, ?, ?)')
    .run(scope, ip || '', now());
}

export function clearLoginAttempts(scope, ip) {
  getDb().prepare('DELETE FROM login_attempts WHERE scope = ? AND ip = ?').run(scope, ip || '');
}

// Returns { blocked: boolean, retryAfterSec: number }
export function checkLoginRate(scope, ip) {
  const cfg = loadConfig();
  const windowMs = cfg.loginWindowMinutes * 60 * 1000;
  const since = now() - windowMs;
  const row = getDb()
    .prepare(
      'SELECT COUNT(*) AS c, MAX(created_at) AS last FROM login_attempts WHERE scope = ? AND ip = ? AND created_at > ?'
    )
    .get(scope, ip || '', since);
  if (row.c >= cfg.loginMaxAttempts) {
    const unlockAt = row.last + cfg.loginLockMinutes * 60 * 1000;
    const retry = Math.max(1, Math.ceil((unlockAt - now()) / 1000));
    if (now() < unlockAt) return { blocked: true, retryAfterSec: retry };
    // window passed since lock -> allow and clear
    clearLoginAttempts(scope, ip);
  }
  return { blocked: false, retryAfterSec: 0 };
}

export function cleanupLoginAttempts() {
  const cfg = loadConfig();
  const since = now() - Math.max(cfg.loginWindowMinutes, cfg.loginLockMinutes) * 60 * 1000;
  getDb().prepare('DELETE FROM login_attempts WHERE created_at < ?').run(since);
}

// ---- CSRF ----
// Enforced for any unsafe method on authenticated API routes. The SPA reads the
// token from the bootstrap payload / cookie and echoes it in X-CSRF-Token.

export function enforceCsrf(ctx) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(ctx.method)) return;
  if (!ctx.session) return; // unauthenticated routes guard themselves
  const header = ctx.req.headers['x-csrf-token'] || ctx.body?.csrf || '';
  if (!header || !safeEqual(header, ctx.session.csrf)) {
    throw new HttpError(403, 'Invalid or missing CSRF token');
  }
}
