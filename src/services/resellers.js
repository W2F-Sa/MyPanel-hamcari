// Reseller (agent) management: creation with a high-entropy login token,
// integer-only balance/price bookkeeping, and balance adjustments recorded as
// immutable transactions.

import { getDb, now } from '../lib/db.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { HttpError } from '../lib/http.js';

const TOKEN_PREFIX = 'agent_';

function publicRow(row, extra = {}) {
  if (!row) return null;
  let allowed = [];
  try {
    allowed = JSON.parse(row.allowed_inbounds || '[]');
  } catch {
    allowed = [];
  }
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    panelId: row.panel_id,
    allowedInbounds: allowed,
    pricePerGb: row.price_per_gb,
    balance: row.balance,
    defaultDays: row.default_days,
    maxGb: row.max_gb,
    defaultLimitIp: row.default_limit_ip,
    enabled: !!row.enabled,
    note: row.note || '',
    tokenHint: row.token_hint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra,
  };
}

export function listResellers() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM resellers ORDER BY id ASC').all();
  return rows.map((r) => {
    const count = db
      .prepare('SELECT COUNT(*) AS c FROM vpn_users WHERE reseller_id = ?')
      .get(r.id).c;
    return publicRow(r, { userCount: count });
  });
}

export function getResellerRow(id) {
  return getDb().prepare('SELECT * FROM resellers WHERE id = ?').get(id);
}

export function getResellerPublic(id) {
  const row = getResellerRow(id);
  if (!row) return null;
  const count = getDb()
    .prepare('SELECT COUNT(*) AS c FROM vpn_users WHERE reseller_id = ?')
    .get(id).c;
  return publicRow(row, { userCount: count });
}

function genToken() {
  const raw = TOKEN_PREFIX + randomToken(24);
  return { raw, hash: sha256(raw), hint: '****' + raw.slice(-4) };
}

export function createReseller(data) {
  const db = getDb();
  if (data.username) {
    const exists = db.prepare('SELECT id FROM resellers WHERE username = ?').get(data.username);
    if (exists) throw new HttpError(400, 'A reseller with that username already exists');
  }
  const token = genToken();
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO resellers
       (name, username, token_hash, token_hint, panel_id, allowed_inbounds, price_per_gb,
        balance, default_days, max_gb, default_limit_ip, enabled, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.name,
      data.username || null,
      token.hash,
      token.hint,
      data.panelId || null,
      JSON.stringify(data.allowedInbounds || []),
      data.pricePerGb,
      data.balance || 0,
      data.defaultDays,
      data.maxGb,
      data.defaultLimitIp || 0,
      data.enabled ? 1 : 0,
      data.note || '',
      ts,
      ts
    );
  if ((data.balance || 0) !== 0) {
    db.prepare(
      `INSERT INTO transactions (reseller_id, amount, type, balance_after, actor, note, created_at)
       VALUES (?, ?, 'initial', ?, ?, ?, ?)`
    ).run(info.lastInsertRowid, data.balance, data.balance, data.actor || 'admin', 'Initial balance', ts);
  }
  return { reseller: getResellerPublic(info.lastInsertRowid), token: token.raw };
}

export function updateReseller(id, data) {
  const row = getResellerRow(id);
  if (!row) throw new HttpError(404, 'Reseller not found');
  const db = getDb();
  if (data.username && data.username !== row.username) {
    const exists = db
      .prepare('SELECT id FROM resellers WHERE username = ? AND id != ?')
      .get(data.username, id);
    if (exists) throw new HttpError(400, 'A reseller with that username already exists');
  }
  db.prepare(
    `UPDATE resellers SET name = ?, username = ?, panel_id = ?, allowed_inbounds = ?,
       price_per_gb = ?, default_days = ?, max_gb = ?, default_limit_ip = ?,
       enabled = ?, note = ?, updated_at = ? WHERE id = ?`
  ).run(
    data.name !== undefined ? data.name : row.name,
    data.username !== undefined ? data.username || null : row.username,
    data.panelId !== undefined ? data.panelId || null : row.panel_id,
    data.allowedInbounds !== undefined ? JSON.stringify(data.allowedInbounds) : row.allowed_inbounds,
    data.pricePerGb !== undefined ? data.pricePerGb : row.price_per_gb,
    data.defaultDays !== undefined ? data.defaultDays : row.default_days,
    data.maxGb !== undefined ? data.maxGb : row.max_gb,
    data.defaultLimitIp !== undefined ? data.defaultLimitIp : row.default_limit_ip,
    data.enabled !== undefined ? (data.enabled ? 1 : 0) : row.enabled,
    data.note !== undefined ? data.note : row.note,
    now(),
    id
  );
  return getResellerPublic(id);
}

export function deleteReseller(id) {
  const row = getResellerRow(id);
  if (!row) throw new HttpError(404, 'Reseller not found');
  getDb().prepare('DELETE FROM resellers WHERE id = ?').run(id);
  return true;
}

// Rotate the login token. Returns the new raw token (shown once).
export function rotateToken(id) {
  const row = getResellerRow(id);
  if (!row) throw new HttpError(404, 'Reseller not found');
  const token = genToken();
  getDb()
    .prepare('UPDATE resellers SET token_hash = ?, token_hint = ?, updated_at = ? WHERE id = ?')
    .run(token.hash, token.hint, now(), id);
  return token.raw;
}

export function authenticateByToken(rawToken) {
  if (!rawToken) return null;
  const hash = sha256(String(rawToken).trim());
  const row = getDb().prepare('SELECT * FROM resellers WHERE token_hash = ?').get(hash);
  if (!row) return null;
  if (!row.enabled) return { disabled: true, row };
  return { row };
}

// Adjust balance by an integer delta inside a transaction. type is one of
// 'topup' | 'deduct' | 'refund' | 'charge' | 'initial' | 'adjust'.
export function adjustBalance(id, delta, type, actor, note = '', { allowNegative = true } = {}) {
  const db = getDb();
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT balance FROM resellers WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Reseller not found');
    const next = row.balance + delta;
    if (!allowNegative && next < 0) {
      throw new HttpError(400, 'Insufficient balance');
    }
    db.prepare('UPDATE resellers SET balance = ?, updated_at = ? WHERE id = ?').run(next, now(), id);
    db.prepare(
      `INSERT INTO transactions (reseller_id, amount, type, balance_after, actor, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, delta, type, next, actor, note, now());
    return next;
  });
  return tx();
}

export function listTransactions(resellerId, limit = 100) {
  return getDb()
    .prepare('SELECT * FROM transactions WHERE reseller_id = ? ORDER BY id DESC LIMIT ?')
    .all(resellerId, Math.min(limit, 500));
}
