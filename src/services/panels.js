// Panel registry: CRUD for upstream 3x-ui panels plus connection testing.
// API tokens are stored encrypted (AES-256-GCM) and only decrypted in memory
// when a request to the upstream panel is made.

import { getDb, now } from '../lib/db.js';
import { encryptSecret, decryptSecret } from '../lib/crypto.js';
import { XuiClient, summarizeStatus } from './xuiClient.js';
import { HttpError } from '../lib/http.js';

function normalizeBaseUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new HttpError(400, 'Panel URL is required');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  // strip trailing slash and an accidental /panel suffix
  s = s.replace(/\/+$/, '');
  s = s.replace(/\/panel$/i, '');
  try {
    // validate
    // eslint-disable-next-line no-new
    new URL(s);
  } catch {
    throw new HttpError(400, 'Panel URL is not a valid URL');
  }
  return s;
}

// Public-facing shape (never leaks the token).
function publicRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    enabled: !!row.enabled,
    insecure: !!row.insecure,
    lastStatus: row.last_status,
    lastError: row.last_error,
    lastChecked: row.last_checked,
    tokenSet: !!row.api_token_enc,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPanels() {
  const rows = getDb().prepare('SELECT * FROM panels ORDER BY id ASC').all();
  return rows.map(publicRow);
}

export function getPanelRow(id) {
  return getDb().prepare('SELECT * FROM panels WHERE id = ?').get(id);
}

export function getPanelPublic(id) {
  return publicRow(getPanelRow(id));
}

export function clientForPanel(row) {
  if (!row) throw new HttpError(404, 'Panel not found');
  const token = decryptSecret(row.api_token_enc);
  return new XuiClient(row.base_url, token, { insecure: !!row.insecure });
}

export function createPanel({ name, baseUrl, apiToken, insecure = false, enabled = true }) {
  const url = normalizeBaseUrl(baseUrl);
  if (!apiToken) throw new HttpError(400, 'API token is required');
  const ts = now();
  const info = getDb()
    .prepare(
      `INSERT INTO panels (name, base_url, api_token_enc, enabled, insecure, last_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'unknown', ?, ?)`
    )
    .run(name, url, encryptSecret(apiToken), enabled ? 1 : 0, insecure ? 1 : 0, ts, ts);
  return getPanelPublic(info.lastInsertRowid);
}

export function updatePanel(id, { name, baseUrl, apiToken, insecure, enabled }) {
  const row = getPanelRow(id);
  if (!row) throw new HttpError(404, 'Panel not found');
  const url = baseUrl !== undefined ? normalizeBaseUrl(baseUrl) : row.base_url;
  // Only replace the token when a new (non-empty) value is supplied.
  const tokenEnc = apiToken ? encryptSecret(apiToken) : row.api_token_enc;
  getDb()
    .prepare(
      `UPDATE panels SET name = ?, base_url = ?, api_token_enc = ?, insecure = ?, enabled = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      name !== undefined ? name : row.name,
      url,
      tokenEnc,
      insecure !== undefined ? (insecure ? 1 : 0) : row.insecure,
      enabled !== undefined ? (enabled ? 1 : 0) : row.enabled,
      now(),
      id
    );
  return getPanelPublic(id);
}

export function deletePanel(id) {
  const row = getPanelRow(id);
  if (!row) throw new HttpError(404, 'Panel not found');
  getDb().prepare('DELETE FROM panels WHERE id = ?').run(id);
  return true;
}

export function recordHealth(id, status, error = '') {
  getDb()
    .prepare('UPDATE panels SET last_status = ?, last_error = ?, last_checked = ? WHERE id = ?')
    .run(status, error || '', now(), id);
}

// Test a stored panel by id; updates its cached health.
export async function testPanelById(id) {
  const row = getPanelRow(id);
  if (!row) throw new HttpError(404, 'Panel not found');
  const client = clientForPanel(row);
  try {
    const status = await client.status();
    recordHealth(id, 'online', '');
    return { ok: true, health: summarizeStatus(status) };
  } catch (err) {
    recordHealth(id, 'offline', err.message);
    return { ok: false, error: err.message };
  }
}

// Test arbitrary connection details without saving.
export async function testConnection({ baseUrl, apiToken, insecure = false }) {
  const url = normalizeBaseUrl(baseUrl);
  if (!apiToken) throw new HttpError(400, 'API token is required');
  const client = new XuiClient(url, apiToken, { insecure });
  try {
    const status = await client.status();
    return { ok: true, health: summarizeStatus(status) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Fetch inbound options (id/remark/protocol/port) for the picker UI.
export async function panelInbounds(id) {
  const row = getPanelRow(id);
  if (!row) throw new HttpError(404, 'Panel not found');
  const client = clientForPanel(row);
  const opts = await client.inboundOptions();
  return opts.map((o) => ({
    id: o.id,
    remark: o.remark,
    protocol: o.protocol,
    port: o.port,
  }));
}
