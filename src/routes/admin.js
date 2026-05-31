// Admin portal API routes.

import { Router } from '../lib/http.js';
import { requireAdmin } from '../middleware/auth.js';
import { finishLogin, doLogout } from './helpers.js';
import {
  verifyAdmin,
  getAdminUsername,
  changePassword,
} from '../services/admin.js';
import {
  recordLoginAttempt,
  clearLoginAttempts,
  checkLoginRate,
} from '../lib/security.js';
import {
  listPanels,
  createPanel,
  updatePanel,
  deletePanel,
  testPanelById,
  testConnection,
  panelInbounds,
  getPanelPublic,
} from '../services/panels.js';
import {
  listResellers,
  getResellerPublic,
  createReseller,
  updateReseller,
  deleteReseller,
  rotateToken,
  adjustBalance,
  listTransactions,
} from '../services/resellers.js';
import {
  listAllUsers,
  listUsersForReseller,
  deleteUser,
  renewUser,
  getUserDetails,
} from '../services/users.js';
import { getDb } from '../lib/db.js';
import { audit, listAudit } from '../lib/audit.js';
import { asString, asInt, asBool, asIntArray, asEmailKey } from '../lib/validate.js';
import { loadConfig } from '../config.js';

export function buildAdminRouter() {
  const r = new Router();

  // ---- auth ----
  r.get('/api/me', (ctx) => {
    if (!ctx.session || ctx.session.kind !== 'admin') {
      return ctx.ok({ authenticated: false });
    }
    ctx.ok({
      authenticated: true,
      csrf: ctx.session.csrf,
      identity: { kind: 'admin', username: getAdminUsername() },
    });
  });

  r.post('/api/login', (ctx) => {
    const ip = ctx.clientIp();
    const rate = checkLoginRate('admin', ip);
    if (rate.blocked) {
      return ctx.fail(`Too many attempts. Try again in ${rate.retryAfterSec}s`, 429);
    }
    const username = asString(ctx.body.username, 'username', { max: 64 });
    const password = asString(ctx.body.password, 'password', { max: 256 });
    if (!verifyAdmin(username, password)) {
      recordLoginAttempt('admin', ip);
      audit('admin', 'login_failed', username, ip);
      return ctx.fail('Wrong username or password', 401);
    }
    clearLoginAttempts('admin', ip);
    const csrf = finishLogin(ctx, 'admin', 0);
    audit('admin', 'login_ok', username, ip);
    ctx.ok({ csrf, identity: { kind: 'admin', username } }, 'Logged in');
  });

  r.post('/api/logout', (ctx) => {
    doLogout(ctx);
    ctx.ok(null, 'Logged out');
  });

  r.post('/api/change-password', (ctx) => {
    requireAdmin(ctx);
    const oldPassword = asString(ctx.body.oldPassword, 'oldPassword', { max: 256 });
    const newUsername = asString(ctx.body.newUsername, 'newUsername', { required: false, max: 64 });
    const newPassword = asString(ctx.body.newPassword, 'newPassword', { max: 256, min: 8 });
    changePassword(oldPassword, newUsername, newPassword);
    audit('admin', 'change_password', '', ctx.clientIp());
    ctx.ok(null, 'Credentials updated');
  });

  // ---- dashboard ----
  r.get('/api/dashboard', (ctx) => {
    requireAdmin(ctx);
    const db = getDb();
    const resellerCount = db.prepare('SELECT COUNT(*) AS c FROM resellers').get().c;
    const userCount = db.prepare('SELECT COUNT(*) AS c FROM vpn_users').get().c;
    const panelCount = db.prepare('SELECT COUNT(*) AS c FROM panels').get().c;
    const balanceSum = db.prepare('SELECT COALESCE(SUM(balance),0) AS s FROM resellers').get().s;
    const revenue = db
      .prepare("SELECT COALESCE(SUM(-amount),0) AS s FROM transactions WHERE type = 'charge'")
      .get().s;
    const gbSold = db.prepare('SELECT COALESCE(SUM(gb),0) AS s FROM vpn_users').get().s;
    ctx.ok({
      resellerCount,
      userCount,
      panelCount,
      outstandingBalance: balanceSum,
      revenue,
      gbSold,
      panels: listPanels(),
    });
  });

  // ---- panels ----
  r.get('/api/panels', (ctx) => {
    requireAdmin(ctx);
    ctx.ok(listPanels());
  });

  r.post('/api/panels', async (ctx) => {
    requireAdmin(ctx);
    const name = asString(ctx.body.name, 'name', { max: 64 });
    const baseUrl = asString(ctx.body.baseUrl, 'baseUrl', { max: 256 });
    const apiToken = asString(ctx.body.apiToken, 'apiToken', { max: 512 });
    const insecure = asBool(ctx.body.insecure, false);
    const panel = createPanel({ name, baseUrl, apiToken, insecure, enabled: true });
    audit('admin', 'panel_create', { id: panel.id, name }, ctx.clientIp());
    ctx.ok(panel, 'Panel added');
  });

  r.post('/api/panels/test', async (ctx) => {
    requireAdmin(ctx);
    const baseUrl = asString(ctx.body.baseUrl, 'baseUrl', { max: 256 });
    const apiToken = asString(ctx.body.apiToken, 'apiToken', { max: 512 });
    const insecure = asBool(ctx.body.insecure, false);
    const result = await testConnection({ baseUrl, apiToken, insecure });
    ctx.ok(result);
  });

  r.post('/api/panels/:id', async (ctx) => {
    requireAdmin(ctx);
    const id = asInt(ctx.params.id, 'id');
    const patch = {};
    if (ctx.body.name !== undefined) patch.name = asString(ctx.body.name, 'name', { max: 64 });
    if (ctx.body.baseUrl !== undefined) patch.baseUrl = asString(ctx.body.baseUrl, 'baseUrl', { max: 256 });
    if (ctx.body.apiToken) patch.apiToken = asString(ctx.body.apiToken, 'apiToken', { max: 512 });
    if (ctx.body.insecure !== undefined) patch.insecure = asBool(ctx.body.insecure);
    if (ctx.body.enabled !== undefined) patch.enabled = asBool(ctx.body.enabled);
    const panel = updatePanel(id, patch);
    audit('admin', 'panel_update', { id }, ctx.clientIp());
    ctx.ok(panel, 'Panel updated');
  });

  r.post('/api/panels/:id/delete', (ctx) => {
    requireAdmin(ctx);
    const id = asInt(ctx.params.id, 'id');
    deletePanel(id);
    audit('admin', 'panel_delete', { id }, ctx.clientIp());
    ctx.ok(null, 'Panel deleted');
  });

  r.post('/api/panels/:id/test', async (ctx) => {
    requireAdmin(ctx);
    const id = asInt(ctx.params.id, 'id');
    const result = await testPanelById(id);
    ctx.ok({ ...result, panel: getPanelPublic(id) });
  });

  r.get('/api/panels/:id/inbounds', async (ctx) => {
    requireAdmin(ctx);
    const id = asInt(ctx.params.id, 'id');
    const inbounds = await panelInbounds(id);
    ctx.ok(inbounds);
  });

  // ---- resellers ----
  r.get('/api/resellers', (ctx) => {
    requireAdmin(ctx);
    ctx.ok(listResellers());
  });

  r.get('/api/resellers/:id', (ctx) => {
    requireAdmin(ctx);
    const id = asInt(ctx.params.id, 'id');
    const reseller = getResellerPublic(id);
    if (!reseller) return ctx.fail('Reseller not found', 404);
    ctx.ok(reseller);
  });

  r.post('/api/resellers', (ctx) => {
    requireAdmin(ctx);
    const data = parseResellerBody(ctx, true);
    data.actor = 'admin';
    const { reseller, token } = createReseller(data);
    audit('admin', 'reseller_create', { id: reseller.id, name: reseller.name }, ctx.clientIp());
    ctx.ok({ reseller, token }, 'Reseller created');
  });

  r.post('/api/resellers/:id', (ctx) => {
    requireAdmin(ctx);
    const id = asInt(ctx.params.id, 'id');
    const data = parseResellerBody(ctx, false);
    const reseller = updateReseller(id, data);
    audit('admin', 'reseller_update', { id }, ctx.clientIp());
    ctx.ok(reseller, 'Reseller updated');
  });

  r.post('/api/resellers/:id/delete', (ctx) => {
    requireAdmin(ctx);
    const id = asInt(ctx.params.id, 'id');
    deleteReseller(id);
    audit('admin', 'reseller_delete', { id }, ctx.clientIp());
    ctx.ok(null, 'Reseller deleted');
  });

  r.post('/api/resellers/:id/rotate-token', (ctx) => {
    requireAdmin(ctx);
    const id = asInt(ctx.params.id, 'id');
    const token = rotateToken(id);
    audit('admin', 'reseller_rotate_token', { id }, ctx.clientIp());
    ctx.ok({ token }, 'Token rotated');
  });

  // top-up / deduct balance (integer Toman)
  r.post('/api/resellers/:id/balance', (ctx) => {
    requireAdmin(ctx);
    const id = asInt(ctx.params.id, 'id');
    const op = asString(ctx.body.op, 'op', { max: 16 }); // 'add' | 'deduct'
    const amount = asInt(ctx.body.amount, 'amount', { min: 1 });
    const note = asString(ctx.body.note, 'note', { required: false, max: 256 });
    const delta = op === 'deduct' ? -amount : amount;
    const type = op === 'deduct' ? 'deduct' : 'topup';
    const allowNegative = op === 'deduct'; // admin may push a reseller negative on purpose
    const balance = adjustBalance(id, delta, type, 'admin', note, { allowNegative });
    audit('admin', 'reseller_balance', { id, delta, balance }, ctx.clientIp());
    ctx.ok({ balance }, op === 'deduct' ? 'Balance reduced' : 'Balance increased');
  });

  r.get('/api/resellers/:id/transactions', (ctx) => {
    requireAdmin(ctx);
    const id = asInt(ctx.params.id, 'id');
    ctx.ok(listTransactions(id, 200));
  });

  r.get('/api/resellers/:id/users', (ctx) => {
    requireAdmin(ctx);
    const id = asInt(ctx.params.id, 'id');
    ctx.ok(listUsersForReseller(id));
  });

  // ---- users (global view) ----
  r.get('/api/users', (ctx) => {
    requireAdmin(ctx);
    ctx.ok(listAllUsers());
  });

  r.get('/api/users/:id', async (ctx) => {
    requireAdmin(ctx);
    const id = asInt(ctx.params.id, 'id');
    ctx.ok(await getUserDetails(id, {}));
  });

  r.post('/api/users/:id/renew', async (ctx) => {
    requireAdmin(ctx);
    const id = asInt(ctx.params.id, 'id');
    const addGb = asInt(ctx.body.addGb, 'addGb', { min: 0, def: 0 });
    const addDays = asInt(ctx.body.addDays, 'addDays', { min: 0, def: 0 });
    const result = await renewUser(id, { addGb, addDays }, 'admin');
    audit('admin', 'user_renew', { id, addGb, addDays }, ctx.clientIp());
    ctx.ok(result, 'User updated');
  });

  r.post('/api/users/:id/delete', async (ctx) => {
    requireAdmin(ctx);
    const id = asInt(ctx.params.id, 'id');
    const refund = asBool(ctx.body.refund, false);
    await deleteUser(id, { refund, actor: 'admin' });
    audit('admin', 'user_delete', { id, refund }, ctx.clientIp());
    ctx.ok(null, 'User deleted');
  });

  // ---- audit ----
  r.get('/api/audit', (ctx) => {
    requireAdmin(ctx);
    ctx.ok(listAudit(200));
  });

  return r;
}

function parseResellerBody(ctx, isCreate) {
  const cfg = loadConfig();
  const out = {};
  if (isCreate || ctx.body.name !== undefined) out.name = asString(ctx.body.name, 'name', { max: 64 });
  if (isCreate || ctx.body.username !== undefined)
    out.username = ctx.body.username ? asEmailKey(ctx.body.username, 'username', { required: false }) : '';
  if (isCreate || ctx.body.pricePerGb !== undefined)
    out.pricePerGb = asInt(ctx.body.pricePerGb, 'pricePerGb', { min: 0 });
  if (isCreate || ctx.body.panelId !== undefined)
    out.panelId = ctx.body.panelId ? asInt(ctx.body.panelId, 'panelId', { min: 1 }) : null;
  if (isCreate || ctx.body.allowedInbounds !== undefined)
    out.allowedInbounds = asIntArray(ctx.body.allowedInbounds || [], 'allowedInbounds', { min: 1 });
  if (isCreate || ctx.body.defaultDays !== undefined)
    out.defaultDays = asInt(ctx.body.defaultDays, 'defaultDays', { min: 0, def: 30 });
  if (isCreate || ctx.body.maxGb !== undefined)
    out.maxGb = asInt(ctx.body.maxGb, 'maxGb', { min: 1, max: 100000, def: cfg.maxGbPerUser });
  if (isCreate || ctx.body.defaultLimitIp !== undefined)
    out.defaultLimitIp = asInt(ctx.body.defaultLimitIp, 'defaultLimitIp', { min: 0, def: 0 });
  if (isCreate || ctx.body.note !== undefined)
    out.note = asString(ctx.body.note, 'note', { required: false, max: 256 });
  if (isCreate) {
    out.balance = asInt(ctx.body.balance, 'balance', { def: 0 });
    out.enabled = asBool(ctx.body.enabled, true);
  } else if (ctx.body.enabled !== undefined) {
    out.enabled = asBool(ctx.body.enabled);
  }
  return out;
}
