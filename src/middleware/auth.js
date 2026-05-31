// Authentication middleware. Resolves the session cookie into ctx.session and
// guards admin / reseller routes.

import { getSession } from '../lib/sessions.js';
import { sessionCookieName } from '../routes/helpers.js';
import { HttpError } from '../lib/http.js';
import { getResellerRow } from '../services/resellers.js';

export function resolveSession(ctx) {
  // Cookie name is namespaced per portal so admin/reseller don't collide.
  const name = ctx.portal ? sessionCookieName(ctx.portal) : null;
  const raw = name ? ctx.cookies[name] : null;
  const row = getSession(raw);
  // Guard against a session cookie from the other portal being replayed here.
  if (row && ctx.portal && row.kind !== ctx.portal) {
    ctx.session = null;
    ctx.rawSessionId = null;
    return null;
  }
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
