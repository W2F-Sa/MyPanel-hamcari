// Server-side session store backed by SQLite. The raw session id lives only in
// the client's HttpOnly cookie; the DB stores its SHA-256 so a DB leak cannot
// be replayed as a live session. Each session carries a CSRF token.

import { getDb, now } from './db.js';
import { randomToken, sha256 } from './crypto.js';
import { loadConfig } from '../config.js';

export const SESSION_COOKIE = 'mp_sid';

export function createSession(kind, subjectId, ip, userAgent) {
  const cfg = loadConfig();
  const raw = randomToken(32);
  const id = sha256(raw);
  const csrf = randomToken(24);
  const created = now();
  const expires = created + cfg.sessionTtlHours * 3600 * 1000;
  getDb()
    .prepare(
      `INSERT INTO sessions (id, kind, subject_id, csrf, ip, user_agent, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, kind, subjectId || 0, csrf, ip || '', (userAgent || '').slice(0, 256), created, expires);
  return { raw, csrf, expires };
}

export function getSession(rawId) {
  if (!rawId) return null;
  const id = sha256(rawId);
  const row = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!row) return null;
  if (row.expires_at < now()) {
    destroySession(rawId);
    return null;
  }
  return row;
}

export function destroySession(rawId) {
  if (!rawId) return;
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sha256(rawId));
}

export function destroyAllForSubject(kind, subjectId) {
  getDb().prepare('DELETE FROM sessions WHERE kind = ? AND subject_id = ?').run(kind, subjectId);
}

export function cleanupSessions() {
  getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
}

// Cookie attributes shared by login/logout.
export function sessionCookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: maxAgeMs != null ? maxAgeMs / 1000 : undefined,
  };
}
