// Append-only audit trail for sensitive actions.

import { getDb, now } from './db.js';

export function audit(actor, action, detail = '', ip = '') {
  try {
    getDb()
      .prepare('INSERT INTO audit_log (actor, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(String(actor), String(action), typeof detail === 'string' ? detail : JSON.stringify(detail), ip || '', now());
  } catch {
    /* auditing must never break the request */
  }
}

export function listAudit(limit = 200, offset = 0) {
  return getDb()
    .prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(Math.min(limit, 1000), offset);
}
