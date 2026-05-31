// One-time initialization: write data/config.json (stable secrets + obscure
// portal paths) and seed a random admin account. Idempotent — existing config
// and admin are preserved unless --force is passed.
//
// Env overrides: MYPANEL_PORT, MYPANEL_ADMIN_PATH, MYPANEL_RESELLER_PATH,
// MYPANEL_ADMIN_USER, MYPANEL_ADMIN_PASS.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { defaultConfig, saveConfig, CONFIG_PATH, ensureDataDir, normalizePath } from '../config.js';
import { getDb } from '../lib/db.js';
import { adminExists, setAdminCredentials, getAdminUsername } from '../services/admin.js';

function strongPassword(len = 18) {
  // Unambiguous alphabet (no O/0/I/l/1) for human-friendly copy/paste.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#%+=?';
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

const force = process.argv.includes('--force');

ensureDataDir();

let cfg;
if (fs.existsSync(CONFIG_PATH)) {
  cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  // Backfill any newly added defaults.
  const def = defaultConfig();
  cfg = { ...def, ...cfg, tls: { ...def.tls, ...(cfg.tls || {}) } };
} else {
  cfg = defaultConfig();
}

// Env overrides (only meaningful on first creation, but harmless otherwise).
if (process.env.MYPANEL_PORT) cfg.port = parseInt(process.env.MYPANEL_PORT, 10);
if (process.env.MYPANEL_ADMIN_PATH) cfg.adminPath = normalizePath(process.env.MYPANEL_ADMIN_PATH);
if (process.env.MYPANEL_RESELLER_PATH) cfg.resellerPath = normalizePath(process.env.MYPANEL_RESELLER_PATH);

saveConfig(cfg);

getDb();

let credsLine = 'Admin account already exists (kept). Use reset-admin to change it.';
if (!adminExists() || force) {
  const user = process.env.MYPANEL_ADMIN_USER || 'admin_' + crypto.randomBytes(3).toString('hex');
  const pass = process.env.MYPANEL_ADMIN_PASS || strongPassword(18);
  setAdminCredentials(user, pass);
  credsLine = `  Admin username : ${user}\n  Admin password : ${pass}`;
}

const out = [
  '',
  '=================  MyPanel — initialization complete  =================',
  '',
  `  Listen port    : ${cfg.port}`,
  `  Admin path     : ${cfg.adminPath}`,
  `  Reseller path  : ${cfg.resellerPath}`,
  '',
  credsLine,
  '',
  '  Config file    : ' + CONFIG_PATH,
  '  (Keep this file private — it holds the encryption & session keys.)',
  '======================================================================',
  '',
].join('\n');

// eslint-disable-next-line no-console
console.log(out);
