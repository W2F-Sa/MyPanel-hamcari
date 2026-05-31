// Shared route helpers: login session bootstrap and the CSRF cookie.

import { createSession, destroySession, SESSION_COOKIE, sessionCookieOptions } from '../lib/sessions.js';
import { loadConfig } from '../config.js';

export const CSRF_COOKIE = 'mp_csrf';

export function finishLogin(ctx, kind, subjectId) {
  const cfg = loadConfig();
  const maxAgeMs = cfg.sessionTtlHours * 3600 * 1000;
  const { raw, csrf } = createSession(kind, subjectId, ctx.clientIp(), ctx.req.headers['user-agent']);
  ctx.setCookie(SESSION_COOKIE, raw, sessionCookieOptions(maxAgeMs));
  // CSRF token is readable by JS (double-submit); the session cookie is not.
  ctx.setCookie(CSRF_COOKIE, csrf, {
    httpOnly: false,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: maxAgeMs / 1000,
  });
  return csrf;
}

export function doLogout(ctx) {
  if (ctx.rawSessionId) destroySession(ctx.rawSessionId);
  ctx.clearCookie(SESSION_COOKIE, { path: '/' });
  ctx.clearCookie(CSRF_COOKIE, { path: '/', httpOnly: false });
}
