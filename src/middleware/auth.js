// Authentication middleware. Resolves the session cookie into ctx.session and
// guards admin / reseller routes.

import { getSession, SESSION_COOKIE } from '../lib/sessions.js';
import { HttpError } from '../lib/http.js';
import { getResellerRow } from '../services/resellers.js';

export function resolveSession(ctx) {
  const raw = ctx.cookies[SESSION_COOKIE];
  const row = getSession(raw);
  ctx.session = row || null;
  ctx.rawSessionId = raw || null;
  return row;
}

export function requireAdmin(ctx) {
  if (!ctx.session || ctx.session.kind !== 'admin') {
    throw new HttpError(401, 'Authentication required');
  }
}

export function requireReseller(ctx) {
  if (!ctx.session || ctx.session.kind !== 'reseller') {
    throw new HttpError(401, 'Authentication required');
  }
  const reseller = getResellerRow(ctx.session.subject_id);
  if (!reseller) throw new HttpError(401, 'Account not found');
  if (!reseller.enabled) throw new HttpError(403, 'Account is disabled');
  ctx.reseller = reseller;
  return reseller;
}
