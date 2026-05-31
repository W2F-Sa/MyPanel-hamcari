// Cryptographic helpers: password hashing, secure tokens, constant-time
// comparison and authenticated symmetric encryption (AES-256-GCM) used to keep
// upstream 3x-ui API tokens encrypted at rest.

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { loadConfig } from '../config.js';

const BCRYPT_ROUNDS = 12;

export function hashPassword(plain) {
  return bcrypt.hashSync(String(plain), BCRYPT_ROUNDS);
}

export function verifyPassword(plain, hash) {
  if (!hash) return false;
  try {
    return bcrypt.compareSync(String(plain), hash);
  } catch {
    return false;
  }
}

// URL-safe random token (default 32 bytes -> 43 chars base64url).
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// SHA-256 hex digest — used to store session ids and reseller login tokens
// without keeping the raw value in the DB.
export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// Timing-safe string comparison.
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // Still compare against something of equal length to limit timing leaks.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function getKey() {
  const cfg = loadConfig();
  return Buffer.from(cfg.encryptionKey, 'hex');
}

// Encrypt a secret (e.g. a panel API token). Returns "v1:<iv>:<tag>:<cipher>"
// all base64url. AES-256-GCM gives confidentiality + integrity.
export function encryptSecret(plain) {
  if (plain === null || plain === undefined) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    enc.toString('base64url'),
  ].join(':');
}

export function decryptSecret(payload) {
  if (!payload) return null;
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Malformed encrypted payload');
  }
  const key = getKey();
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const data = Buffer.from(parts[3], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}
