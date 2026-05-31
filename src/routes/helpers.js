// Shared route helpers: login session bootstrap, sliding-expiration refresh,
// and the CSRF cookie.
//
// Cookies are namespaced per portal (mp_sid_admin / mp_sid_reseller) so that
// having both portals open in the same browser never clobbers the other's
// session — which previously looked like "it keeps logging me out".

import { createSession, destroySession, touchSession, sessionCookieOptions } from '../lib/sessions.js';
import { loadConfig } from '../config.js';

export const sessionCookieName = (portal) => `mp_sid_${portal}`;
export const csrfCookieName = (portal) => `mp_csrf_${portal}`;

// Secure flag must be off when serving plain HTTP, otherwise the browser drops
// the cookie and the user appears logged out immediately.
export function cookieSecure() {
  if (process.env.MYPANEL_HTTP === '1') return false;
  try {
    return loadConfig().tls.enabled !== false;
  } catch {
    return true;
  }
}

function csrfCookieOptions(maxAgeMs) {
  return {
    httpOnly: false,
    secure: cookieSecure(),
    sameSite: 'Strict',
    path: '/',
    maxAge: maxAgeMs != null ? maxAgeMs / 1000 : undefined,
  };
}

export function finishLogin(ctx, kind, subjectId) {
  const cfg = loadConfig();
  const maxAgeMs = cfg.sessionTtlHours * 3600 * 1000;
  const { raw, csrf } = createSession(kind, subjectId, ctx.clientIp(), ctx.req.headers['user-agent']);
  ctx.setCookie(sessionCookieName(kind), raw, sessionCookieOptions(maxAgeMs));
  // CSRF token is readable by JS (double-submit); the session cookie is not.
  ctx.setCookie(csrfCookieName(kind), csrf, csrfCookieOptions(maxAgeMs));
  return csrf;
}

export function doLogout(ctx) {
  const portal = ctx.portal || (ctx.session && ctx.session.kind);
  if (ctx.rawSessionId) destroySession(ctx.rawSessionId);
  if (portal) {
    ctx.clearCookie(sessionCookieName(portal), { path: '/' });
    ctx.clearCookie(csrfCookieName(portal), { path: '/', httpOnly: false });
  }
}

// Sliding expiration: while a user is active, push the expiry forward so they
// are not logged out mid-session. Only writes when past the halfway point to
// keep it cheap under load.
export function refreshSessionIfNeeded(ctx) {
  if (!ctx.session || !ctx.rawSessionId) return;
  const cfg = loadConfig();
  const ttlMs = cfg.sessionTtlHours * 3600 * 1000;
  const remaining = ctx.session.expires_at - Date.now();
  if (remaining >= ttlMs / 2) return;
  const newExp = Date.now() + ttlMs;
  touchSession(ctx.rawSessionId, newExp);
  ctx.session.expires_at = newExp;
  const portal = ctx.session.kind;
  ctx.setCookie(sessionCookieName(portal), ctx.rawSessionId, sessionCookieOptions(ttlMs));
  ctx.setCookie(csrfCookieName(portal), ctx.session.csrf, csrfCookieOptions(ttlMs));
}
