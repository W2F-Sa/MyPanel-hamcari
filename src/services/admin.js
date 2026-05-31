// Admin credential management. A single admin account is stored in the
// settings table (username + bcrypt hash).

import { getSetting, setSetting } from '../lib/db.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { HttpError } from '../lib/http.js';

export function adminExists() {
  return !!getSetting('admin_username');
}

export function getAdminUsername() {
  return getSetting('admin_username', '');
}

export function setAdminCredentials(username, password) {
  if (!username || String(username).trim().length < 3) {
    throw new HttpError(400, 'Username must be at least 3 characters');
  }
  if (!password || String(password).length < 8) {
    throw new HttpError(400, 'Password must be at least 8 characters');
  }
  setSetting('admin_username', String(username).trim());
  setSetting('admin_password_hash', hashPassword(password));
}

export function verifyAdmin(username, password) {
  const u = getAdminUsername();
  const h = getSetting('admin_password_hash', '');
  if (!u || !h) return false;
  // Compare username case-sensitively but constant-ish via bcrypt for password.
  if (String(username).trim() !== u) {
    // Still run a bcrypt compare to reduce username/password timing differences.
    verifyPassword(password, '$2a$12$0000000000000000000000000000000000000000000000000000');
    return false;
  }
  return verifyPassword(password, h);
}

export function changePassword(oldPassword, newUsername, newPassword) {
  const h = getSetting('admin_password_hash', '');
  if (!verifyPassword(oldPassword, h)) {
    throw new HttpError(403, 'Current password is incorrect');
  }
  const username = newUsername && newUsername.trim() ? newUsername.trim() : getAdminUsername();
  if (!newPassword || String(newPassword).length < 8) {
    throw new HttpError(400, 'New password must be at least 8 characters');
  }
  setAdminCredentials(username, newPassword);
  return true;
}
