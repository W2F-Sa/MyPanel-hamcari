// Reseller (agent) portal API routes. Resellers authenticate with a single
// high-entropy token and can only see/charge their own users.

import { Router } from '../lib/http.js';
import { requireReseller } from '../middleware/auth.js';
import { finishLogin, doLogout } from './helpers.js';
import { recordLoginAttempt, clearLoginAttempts, checkLoginRate } from '../lib/security.js';
import { authenticateByToken, getResellerPublic, listTransactions } from '../services/resellers.js';
import {
  createUserForReseller,
  listUsersForReseller,
  deleteUser,
  renewUser,
  getUserDetails,
} from '../services/users.js';
import { getPanelRow, clientForPanel } from '../services/panels.js';
import { listPlans, getPlanRow } from '../services/plans.js';
import { audit } from '../lib/audit.js';
import { asString, asInt, asBool } from '../lib/validate.js';

function resellerView(reseller) {
  const pub = getResellerPublic(reseller.id);
  return {
    id: pub.id,
    name: pub.name,
    username: pub.username,
    balance: pub.balance,
    pricePerGb: pub.pricePerGb,
    maxGb: pub.maxGb,
    defaultDays: pub.defaultDays,
    defaultLimitIp: pub.defaultLimitIp,
    allowedInbounds: pub.allowedInbounds,
    userCount: pub.userCount,
    enabled: pub.enabled,
  };
}

export function buildResellerRouter() {
  const r = new Router();

  r.get('/api/me', (ctx) => {
    if (!ctx.session || ctx.session.kind !== 'reseller') {
      return ctx.ok({ authenticated: false });
    }
    const reseller = requireReseller(ctx);
    ctx.ok({
      authenticated: true,
      csrf: ctx.session.csrf,
      identity: { kind: 'reseller', ...resellerView(reseller) },
    });
  });

  r.post('/api/login', (ctx) => {
    const ip = ctx.clientIp();
    const rate = checkLoginRate('reseller', ip);
    if (rate.blocked) {
      return ctx.fail(`Too many attempts. Try again in ${rate.retryAfterSec}s`, 429);
    }
    const token = asString(ctx.body.token, 'token', { max: 256 });
    const auth = authenticateByToken(token);
    if (!auth || !auth.row) {
      recordLoginAttempt('reseller', ip);
      audit('reseller', 'login_failed', '', ip);
      return ctx.fail('Invalid token', 401);
    }
    if (auth.disabled) {
      return ctx.fail('This account is disabled', 403);
    }
    clearLoginAttempts('reseller', ip);
    const csrf = finishLogin(ctx, 'reseller', auth.row.id);
    audit(`reseller:${auth.row.id}`, 'login_ok', auth.row.name, ip);
    ctx.ok({ csrf, identity: { kind: 'reseller', ...resellerView(auth.row) } }, 'Logged in');
  });

  r.post('/api/logout', (ctx) => {
    doLogout(ctx);
    ctx.ok(null, 'Logged out');
  });

  r.get('/api/dashboard', (ctx) => {
    const reseller = requireReseller(ctx);
    const users = listUsersForReseller(reseller.id);
    const totalGb = users.reduce((a, u) => a + (u.gb || 0), 0);
    ctx.ok({
      profile: resellerView(reseller),
      stats: {
        userCount: users.length,
        totalGbSold: totalGb,
        balance: reseller.balance,
        pricePerGb: reseller.price_per_gb,
      },
      recentUsers: users.slice(0, 5),
    });
  });

  // Allowed inbounds enriched with remark/protocol from the panel (best-effort).
  r.get('/api/inbounds', async (ctx) => {
    const reseller = requireReseller(ctx);
    let allowed = [];
    try {
      allowed = JSON.parse(reseller.allowed_inbounds || '[]');
    } catch {
      allowed = [];
    }
    let enriched = allowed.map((id) => ({ id, remark: `Inbound ${id}`, protocol: '', port: 0 }));
    const panel = getPanelRow(reseller.panel_id);
    if (panel && panel.enabled) {
      try {
        const api = clientForPanel(panel);
        const opts = await api.inboundOptions();
        const map = new Map(opts.map((o) => [o.id, o]));
        enriched = allowed.map((id) => {
          const o = map.get(id);
          return o
            ? { id, remark: o.remark, protocol: o.protocol, port: o.port }
            : { id, remark: `Inbound ${id}`, protocol: '', port: 0 };
        });
      } catch {
        /* keep fallback */
      }
    }
    ctx.ok(enriched);
  });

  r.get('/api/plans', (ctx) => {
    requireReseller(ctx);
    ctx.ok(listPlans({ enabledOnly: true }));
  });

  r.get('/api/users', (ctx) => {
    const reseller = requireReseller(ctx);
    ctx.ok(listUsersForReseller(reseller.id));
  });

  r.post('/api/users', async (ctx) => {
    const reseller = requireReseller(ctx);
    const name = asString(ctx.body.name, 'name', { required: false, max: 48 });
    const gb = asInt(ctx.body.gb, 'gb', { min: 1, max: reseller.max_gb });
    const planId = asInt(ctx.body.planId, 'planId', { min: 1 });
    const limitIp = asInt(ctx.body.limitIp, 'limitIp', { min: 0, max: 1000, def: reseller.default_limit_ip || 0 });
    const result = await createUserForReseller(reseller.id, { name, gb, planId, limitIp }, `reseller:${reseller.id}`);
    audit(`reseller:${reseller.id}`, 'user_create', { email: result.user.email, gb, planId }, ctx.clientIp());
    // include links right away
    let links = [];
    try {
      const details = await getUserDetails(result.user.id, { reseller });
      links = details.links;
    } catch {
      /* ignore */
    }
    ctx.ok({ ...result, links }, 'User created');
  });

  r.get('/api/users/:id', async (ctx) => {
    const reseller = requireReseller(ctx);
    const id = asInt(ctx.params.id, 'id');
    ctx.ok(await getUserDetails(id, { reseller }));
  });

  r.post('/api/users/:id/renew', async (ctx) => {
    const reseller = requireReseller(ctx);
    const id = asInt(ctx.params.id, 'id');
    const addGb = asInt(ctx.body.addGb, 'addGb', { min: 0, max: reseller.max_gb, def: 0 });
    // Duration extension comes from a plan (admin-controlled), not free input.
    let addDays = 0;
    if (ctx.body.planId) {
      const plan = getPlanRow(asInt(ctx.body.planId, 'planId', { min: 1 }));
      if (!plan || !plan.enabled) return ctx.fail('Invalid plan', 400);
      addDays = plan.days;
    }
    if (addGb === 0 && addDays === 0) return ctx.fail('Nothing to add', 400);
    const result = await renewUser(id, { addGb, addDays }, `reseller:${reseller.id}`, { reseller });
    audit(`reseller:${reseller.id}`, 'user_renew', { id, addGb, addDays }, ctx.clientIp());
    ctx.ok(result, 'User updated');
  });

  r.post('/api/users/:id/delete', async (ctx) => {
    const reseller = requireReseller(ctx);
    const id = asInt(ctx.params.id, 'id');
    await deleteUser(id, { reseller, refund: false, actor: `reseller:${reseller.id}` });
    audit(`reseller:${reseller.id}`, 'user_delete', { id }, ctx.clientIp());
    ctx.ok(null, 'User deleted');
  });

  r.get('/api/transactions', (ctx) => {
    const reseller = requireReseller(ctx);
    ctx.ok(listTransactions(reseller.id, 100));
  });

  return r;
}
