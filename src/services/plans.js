// Plans: admin-defined durations (in whole days). A reseller picks a plan when
// creating a user — the plan dictates the validity period while the reseller
// chooses the GB volume. Price stays per-reseller (cost = gb * price_per_gb).

import { getDb, now } from '../lib/db.js';
import { HttpError } from '../lib/http.js';

function pub(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    days: row.days,
    enabled: !!row.enabled,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPlans({ enabledOnly = false } = {}) {
  const where = enabledOnly ? 'WHERE enabled = 1' : '';
  return getDb()
    .prepare(`SELECT * FROM plans ${where} ORDER BY sort_order ASC, days ASC, id ASC`)
    .all()
    .map(pub);
}

export function getPlanRow(id) {
  return getDb().prepare('SELECT * FROM plans WHERE id = ?').get(id);
}

export function getPlan(id) {
  return pub(getPlanRow(id));
}

export function createPlan({ name, days, enabled = true, sortOrder = 0 }) {
  const ts = now();
  const info = getDb()
    .prepare(
      `INSERT INTO plans (name, days, enabled, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(name, days, enabled ? 1 : 0, sortOrder, ts, ts);
  return getPlan(info.lastInsertRowid);
}

export function updatePlan(id, data) {
  const row = getPlanRow(id);
  if (!row) throw new HttpError(404, 'Plan not found');
  getDb()
    .prepare(
      `UPDATE plans SET name = ?, days = ?, enabled = ?, sort_order = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      data.name !== undefined ? data.name : row.name,
      data.days !== undefined ? data.days : row.days,
      data.enabled !== undefined ? (data.enabled ? 1 : 0) : row.enabled,
      data.sortOrder !== undefined ? data.sortOrder : row.sort_order,
      now(),
      id
    );
  return getPlan(id);
}

export function deletePlan(id) {
  const row = getPlanRow(id);
  if (!row) throw new HttpError(404, 'Plan not found');
  getDb().prepare('DELETE FROM plans WHERE id = ?').run(id);
  return true;
}

// Seed a few sensible defaults on first run.
export function seedDefaultPlans() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS c FROM plans').get().c;
  if (count > 0) return 0;
  const defaults = [
    { name: 'یک‌ماهه', days: 30, sort: 1 },
    { name: 'دوماهه', days: 60, sort: 2 },
    { name: 'سه‌ماهه', days: 90, sort: 3 },
    { name: 'شش‌ماهه', days: 180, sort: 4 },
    { name: 'یک‌ساله', days: 365, sort: 5 },
  ];
  const ts = now();
  const stmt = db.prepare(
    `INSERT INTO plans (name, days, enabled, sort_order, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)`
  );
  const tx = db.transaction(() => defaults.forEach((p) => stmt.run(p.name, p.days, p.sort, ts, ts)));
  tx();
  return defaults.length;
}
