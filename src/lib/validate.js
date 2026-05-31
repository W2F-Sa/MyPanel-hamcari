// Input validation helpers. Numeric business values (GB, price, balance, days)
// MUST be whole integers — no fractions anywhere, per requirement.

import { HttpError } from './http.js';

export function asString(v, field, { required = true, max = 512, min = 0 } = {}) {
  if (v === undefined || v === null) {
    if (required) throw new HttpError(400, `${field} is required`);
    return '';
  }
  const s = String(v).trim();
  if (required && s.length < Math.max(1, min)) throw new HttpError(400, `${field} is required`);
  if (s.length < min) throw new HttpError(400, `${field} must be at least ${min} characters`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max})`);
  return s;
}

// Strict integer: rejects decimals, NaN, Infinity, and non-integer strings.
export function asInt(v, field, { min = null, max = null, required = true, def = null } = {}) {
  if (v === undefined || v === null || v === '') {
    if (def !== null) return def;
    if (required) throw new HttpError(400, `${field} is required`);
    return 0;
  }
  // Reject anything that is not a whole number representation.
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || !Number.isInteger(v)) {
      throw new HttpError(400, `${field} must be a whole number (no decimals)`);
    }
  } else {
    const s = String(v).trim();
    if (!/^-?\d+$/.test(s)) {
      throw new HttpError(400, `${field} must be a whole number (no decimals)`);
    }
  }
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new HttpError(400, `${field} is out of range`);
  if (min !== null && n < min) throw new HttpError(400, `${field} must be >= ${min}`);
  if (max !== null && n > max) throw new HttpError(400, `${field} must be <= ${max}`);
  return n;
}

export function asBool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

export function asIntArray(v, field, { min = null, max = null } = {}) {
  let arr = v;
  if (typeof v === 'string') {
    try {
      arr = JSON.parse(v);
    } catch {
      arr = v.split(',');
    }
  }
  if (!Array.isArray(arr)) throw new HttpError(400, `${field} must be an array`);
  const out = [];
  for (const item of arr) {
    const n = asInt(item, `${field} item`, { min, max });
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

// Email-ish / identifier used as a client "email" (the unique key on 3x-ui).
// We allow letters, digits, dot, dash, underscore, @ and plus.
export function asEmailKey(v, field = 'email', { required = true } = {}) {
  const s = asString(v, field, { required, max: 120 });
  if (!s) return s;
  if (!/^[A-Za-z0-9._@+-]+$/.test(s)) {
    throw new HttpError(400, `${field} may only contain letters, digits and . _ - @ +`);
  }
  return s;
}

const GB = 1024 * 1024 * 1024;

export function gbToBytes(gb) {
  // gb is a validated integer; keep the product exact (safe up to ~8 PB).
  return gb * GB;
}

export function bytesToGb(bytes) {
  return Math.round((Number(bytes) || 0) / GB);
}

export function daysToExpiry(days) {
  if (!days || days <= 0) return 0; // 0 = unlimited
  return Date.now() + days * 24 * 3600 * 1000;
}
