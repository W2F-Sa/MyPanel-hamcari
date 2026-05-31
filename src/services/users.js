// VPN user lifecycle. A reseller creates a "client" that is attached to every
// inbound the reseller is allowed to sell, charged at price_per_gb. The local
// vpn_users table mirrors what was pushed to the upstream panel so the reseller
// portal can list/charge without re-reading the whole panel.

import { getDb, now } from '../lib/db.js';
import crypto from 'node:crypto';
import { HttpError } from '../lib/http.js';
import { getResellerRow, adjustBalance } from './resellers.js';
import { getPanelRow, clientForPanel, buildSubUrl } from './panels.js';
import { getPlanRow } from './plans.js';
import { gbToBytes, daysToExpiry, bytesToGb } from '../lib/validate.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch a client's links, retrying briefly until we have one per attached
// inbound. The upstream panel occasionally returns a partial set on the first
// call right after creation (node push still settling), so we converge to the
// full list instead of surfacing a short result to the user.
async function fetchLinksStable(api, email, expected, { attempts = 4, delayMs = 500 } = {}) {
  let links = [];
  for (let i = 0; i < attempts; i++) {
    try {
      links = await api.clientLinks(email);
    } catch {
      links = [];
    }
    if (expected <= 0 || links.length >= expected) return links;
    if (i < attempts - 1) await sleep(delayMs); // eslint-disable-line no-await-in-loop
  }
  return links;
}

function sanitizeName(name) {
  return String(name || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '')
    .slice(0, 48);
}

function resellerTag(reseller) {
  return reseller.username ? sanitizeName(reseller.username) : `r${reseller.id}`;
}

function publicUser(row) {
  if (!row) return null;
  let inbounds = [];
  try {
    inbounds = JSON.parse(row.inbound_ids || '[]');
  } catch {
    inbounds = [];
  }
  return {
    id: row.id,
    resellerId: row.reseller_id,
    panelId: row.panel_id,
    email: row.email,
    subId: row.sub_id,
    uuid: row.uuid,
    inboundIds: inbounds,
    gb: row.gb,
    days: row.days,
    expiryTime: row.expiry_time,
    cost: row.cost,
    status: row.status,
    planId: row.plan_id || 0,
    planName: row.plan_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getUserRow(id) {
  return getDb().prepare('SELECT * FROM vpn_users WHERE id = ?').get(id);
}

export function listUsersForReseller(resellerId) {
  const rows = getDb()
    .prepare('SELECT * FROM vpn_users WHERE reseller_id = ? ORDER BY id DESC')
    .all(resellerId);
  return rows.map(publicUser);
}

// Server-side paginated + searchable listing. Keeps payloads small for panels
// with tens of thousands of users. resellerId=null returns all (admin view).
export function listUsersPaged({ resellerId = null, page = 1, pageSize = 25, search = '' } = {}) {
  const db = getDb();
  const size = Math.min(Math.max(parseInt(pageSize, 10) || 25, 1), 200);
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const where = [];
  const params = [];
  if (resellerId != null) {
    where.push('reseller_id = ?');
    params.push(resellerId);
  }
  if (search) {
    where.push('(email LIKE ? OR plan_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM vpn_users ${whereSql}`).get(...params).c;
  const rows = db
    .prepare(`SELECT * FROM vpn_users ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, size, (pg - 1) * size);
  return { items: rows.map(publicUser), total, page: pg, pageSize: size };
}

export function listAllUsers() {
  const rows = getDb().prepare('SELECT * FROM vpn_users ORDER BY id DESC').all();
  return rows.map(publicUser);
}

// Cheap aggregate stats for a reseller (no full table load).
export function resellerStats(resellerId) {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c, COALESCE(SUM(gb),0) AS g FROM vpn_users WHERE reseller_id = ?')
    .get(resellerId);
  return { userCount: row.c, totalGb: row.g };
}

// Create a VPN user for a reseller.
// data: { name, gb, planId, limitIp? }  — duration comes from the admin-defined plan.
export async function createUserForReseller(resellerId, data, actor) {
  const reseller = getResellerRow(resellerId);
  if (!reseller) throw new HttpError(404, 'Reseller not found');
  if (!reseller.enabled) throw new HttpError(403, 'Reseller account is disabled');
  if (!reseller.panel_id) throw new HttpError(400, 'No panel is assigned to this reseller');

  const panel = getPanelRow(reseller.panel_id);
  if (!panel) throw new HttpError(400, 'Assigned panel no longer exists');
  if (!panel.enabled) throw new HttpError(400, 'Assigned panel is disabled');

  let allowed = [];
  try {
    allowed = JSON.parse(reseller.allowed_inbounds || '[]');
  } catch {
    allowed = [];
  }
  if (!allowed.length) throw new HttpError(400, 'No inbounds are assigned to this reseller');

  // Duration is dictated by the selected plan (admin-controlled).
  const plan = getPlanRow(data.planId);
  if (!plan) throw new HttpError(400, 'Invalid plan');
  if (!plan.enabled) throw new HttpError(400, 'Selected plan is disabled');
  const days = plan.days;

  const gb = data.gb;
  const minGb = reseller.min_gb || 1;
  if (gb < minGb) throw new HttpError(400, `Minimum purchase is ${minGb} GB`);
  if (gb > reseller.max_gb) throw new HttpError(400, `Maximum purchase is ${reseller.max_gb} GB`);
  const cost = gb * reseller.price_per_gb; // integers => integer

  if (reseller.balance < cost) {
    throw new HttpError(400, `Insufficient balance. Need ${cost}, have ${reseller.balance}`);
  }

  // Build a namespaced, unique email.
  const tag = resellerTag(reseller);
  const base = sanitizeName(data.name) || Math.random().toString(36).slice(2, 8);
  let email = `${tag}-${base}`;
  const db = getDb();
  // ensure local uniqueness
  let suffix = 0;
  while (db.prepare('SELECT 1 FROM vpn_users WHERE email = ?').get(email)) {
    suffix += 1;
    email = `${tag}-${base}-${suffix}`;
  }

  const client = {
    email,
    totalGB: gbToBytes(gb),
    expiryTime: daysToExpiry(days),
    limitIp: data.limitIp != null ? data.limitIp : reseller.default_limit_ip || 0,
    enable: true,
  };

  const api = clientForPanel(panel);
  // 1) create on the panel
  await api.addClient(client, allowed);

  // 2) read back the generated subId / uuid
  let subId = '';
  let uuid = '';
  try {
    const fetched = await api.getClient(email);
    subId = fetched?.client?.subId || '';
    uuid = fetched?.client?.uuid || '';
  } catch {
    /* non-fatal: links can be re-fetched later */
  }

  // 3) charge + persist atomically; roll back the panel client if charge fails
  try {
    const ts = now();
    const result = db.transaction(() => {
      const balRow = db.prepare('SELECT balance FROM resellers WHERE id = ?').get(resellerId);
      if (balRow.balance < cost) throw new HttpError(400, 'Insufficient balance');
      const nextBal = balRow.balance - cost;
      db.prepare('UPDATE resellers SET balance = ?, updated_at = ? WHERE id = ?').run(nextBal, ts, resellerId);
      const info = db
        .prepare(
          `INSERT INTO vpn_users
           (reseller_id, panel_id, email, sub_id, uuid, inbound_ids, gb, days, expiry_time, cost, status, plan_id, plan_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
        )
        .run(
          resellerId,
          panel.id,
          email,
          subId,
          uuid,
          JSON.stringify(allowed),
          gb,
          days,
          client.expiryTime,
          cost,
          plan.id,
          plan.name,
          ts,
          ts
        );
      db.prepare(
        `INSERT INTO transactions (reseller_id, amount, type, balance_after, actor, note, created_at)
         VALUES (?, ?, 'charge', ?, ?, ?, ?)`
      ).run(resellerId, -cost, nextBal, actor, `Create user ${email} (${gb}GB)`, ts);
      return info.lastInsertRowid;
    })();
    return { user: publicUser(getUserRow(result)) };
  } catch (err) {
    // Roll back the upstream client to avoid an uncharged user.
    try {
      await api.deleteClient(email, false);
    } catch {
      /* best effort */
    }
    throw err;
  }
}

// Renew / top-up an existing user: add GB and/or days, charge addGb*price.
export async function renewUser(userId, { addGb = 0, addDays = 0 }, actor, { reseller = null } = {}) {
  const row = getUserRow(userId);
  if (!row) throw new HttpError(404, 'User not found');
  if (reseller && row.reseller_id !== reseller.id) throw new HttpError(403, 'Not your user');

  const res = getResellerRow(row.reseller_id);
  if (!res) throw new HttpError(404, 'Reseller not found');
  const panel = getPanelRow(row.panel_id);
  if (!panel) throw new HttpError(400, 'Panel no longer exists');

  const cost = addGb * res.price_per_gb;
  if (cost > 0 && res.balance < cost) {
    throw new HttpError(400, `Insufficient balance. Need ${cost}, have ${res.balance}`);
  }

  const api = clientForPanel(panel);
  const fetched = await api.getClient(row.email);
  if (!fetched || !fetched.client) throw new HttpError(404, 'User missing on panel');
  const client = fetched.client;

  const newGb = row.gb + addGb;
  const newDays = row.days + addDays;
  // Recompute expiry from "now" when extending an expired/relative window.
  const baseExpiry =
    client.expiryTime && client.expiryTime > now() ? client.expiryTime : now();
  const newExpiry = addDays > 0 ? baseExpiry + addDays * 24 * 3600 * 1000 : client.expiryTime;

  const updated = {
    ...client,
    // The update endpoint expects the protocol secret in `id` as a string
    // (the get endpoint returns the numeric DB id there instead).
    id: client.uuid || (typeof client.id === 'string' ? client.id : ''),
    totalGB: gbToBytes(newGb),
    expiryTime: newExpiry,
    enable: true,
  };
  await api.updateClient(row.email, updated);

  const db = getDb();
  const ts = now();
  db.transaction(() => {
    if (cost !== 0) {
      const balRow = db.prepare('SELECT balance FROM resellers WHERE id = ?').get(res.id);
      const nextBal = balRow.balance - cost;
      if (nextBal < 0) throw new HttpError(400, 'Insufficient balance');
      db.prepare('UPDATE resellers SET balance = ?, updated_at = ? WHERE id = ?').run(nextBal, ts, res.id);
      db.prepare(
        `INSERT INTO transactions (reseller_id, amount, type, balance_after, actor, note, created_at)
         VALUES (?, ?, 'charge', ?, ?, ?, ?)`
      ).run(res.id, -cost, nextBal, actor, `Renew ${row.email} (+${addGb}GB,+${addDays}d)`, ts);
    }
    db.prepare(
      'UPDATE vpn_users SET gb = ?, days = ?, expiry_time = ?, cost = cost + ?, updated_at = ? WHERE id = ?'
    ).run(newGb, newDays, newExpiry, cost, ts, userId);
  })();

  return { user: publicUser(getUserRow(userId)) };
}

export async function deleteUser(userId, { reseller = null, refund = false, actor = 'admin' } = {}) {
  const row = getUserRow(userId);
  if (!row) throw new HttpError(404, 'User not found');
  if (reseller && row.reseller_id !== reseller.id) throw new HttpError(403, 'Not your user');

  const panel = getPanelRow(row.panel_id);
  if (panel) {
    try {
      const api = clientForPanel(panel);
      await api.deleteClient(row.email, false);
    } catch (err) {
      // If the client is already gone upstream, continue with local cleanup.
      if (!/not found|deleted|exist/i.test(err.message)) throw err;
    }
  }

  const db = getDb();
  db.transaction(() => {
    if (refund && row.cost > 0) {
      const balRow = db.prepare('SELECT balance FROM resellers WHERE id = ?').get(row.reseller_id);
      if (balRow) {
        const nextBal = balRow.balance + row.cost;
        db.prepare('UPDATE resellers SET balance = ?, updated_at = ? WHERE id = ?').run(nextBal, now(), row.reseller_id);
        db.prepare(
          `INSERT INTO transactions (reseller_id, amount, type, balance_after, actor, note, created_at)
           VALUES (?, ?, 'refund', ?, ?, ?, ?)`
        ).run(row.reseller_id, row.cost, nextBal, actor, `Refund for deleted ${row.email}`, now());
      }
    }
    db.prepare('DELETE FROM vpn_users WHERE id = ?').run(userId);
  })();
  return true;
}

// Pull live links + traffic for a user from the panel.
export async function getUserDetails(userId, { reseller = null } = {}) {
  const row = getUserRow(userId);
  if (!row) throw new HttpError(404, 'User not found');
  if (reseller && row.reseller_id !== reseller.id) throw new HttpError(403, 'Not your user');
  const panel = getPanelRow(row.panel_id);
  if (!panel) throw new HttpError(400, 'Panel no longer exists');
  const api = clientForPanel(panel);

  let links = [];
  let traffic = null;
  let expected = 0;
  try {
    expected = JSON.parse(row.inbound_ids || '[]').length;
  } catch {
    expected = 0;
  }
  try {
    links = await fetchLinksStable(api, row.email, expected);
  } catch {
    /* ignore */
  }
  try {
    traffic = await api.clientTraffic(row.email);
  } catch {
    /* ignore */
  }

  return {
    user: publicUser(row),
    links,
    subUrl: buildSubUrl(panel, row.sub_id),
    traffic: traffic
      ? {
          up: traffic.up || 0,
          down: traffic.down || 0,
          total: traffic.total || 0,
          usedGb: bytesToGb((traffic.up || 0) + (traffic.down || 0)),
          totalGb: bytesToGb(traffic.total || 0),
          expiryTime: traffic.expiryTime || row.expiry_time,
        }
      : null,
  };
}

// Revoke: rotate the client's UUID and subscription id so all previously issued
// links/subscriptions stop working, then return the freshly generated set.
export async function revokeUser(userId, { reseller = null, actor = 'admin' } = {}) {
  const row = getUserRow(userId);
  if (!row) throw new HttpError(404, 'User not found');
  if (reseller && row.reseller_id !== reseller.id) throw new HttpError(403, 'Not your user');
  const panel = getPanelRow(row.panel_id);
  if (!panel) throw new HttpError(400, 'Panel no longer exists');

  const api = clientForPanel(panel);
  const fetched = await api.getClient(row.email);
  if (!fetched || !fetched.client) throw new HttpError(404, 'User missing on panel');

  const newUuid = crypto.randomUUID();
  const newSubId = crypto.randomUUID();
  const updated = {
    ...fetched.client,
    id: newUuid, // string id (uuid) expected by the update endpoint
    subId: newSubId,
    enable: true,
  };
  await api.updateClient(row.email, updated);

  getDb()
    .prepare('UPDATE vpn_users SET uuid = ?, sub_id = ?, updated_at = ? WHERE id = ?')
    .run(newUuid, newSubId, now(), userId);

  let expected = 0;
  try {
    expected = JSON.parse(row.inbound_ids || '[]').length;
  } catch {
    expected = 0;
  }
  let links = [];
  try {
    links = await fetchLinksStable(api, row.email, expected);
  } catch {
    /* ignore */
  }
  return { user: publicUser(getUserRow(userId)), links, subUrl: buildSubUrl(panel, newSubId) };
}
