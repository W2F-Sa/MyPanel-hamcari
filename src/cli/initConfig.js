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
import { seedDefaultPlans } from '../services/plans.js';
import { listPanels, createPanel } from '../services/panels.js';

// First-run seed for the upstream 3x-ui panel. Override (or clear) with the
// MYPANEL_SEED_PANEL_URL / MYPANEL_SEED_PANEL_TOKEN env vars. This is a
// first-run convenience only — manage panels from the admin UI afterwards.
// SECURITY: rotate this API token in 3x-ui and update it from the admin panel.
const DEFAULT_SEED_PANEL_URL = 'https://subx1.mosquitto.ir:2087/DgQlHz345yABJaV6Xk';
const DEFAULT_SEED_PANEL_TOKEN = 'jXhgVTSOLj1dg09BGjkrPtu1CN3Qz3vENkN4Bd30nB70zfiL';

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

// Seed default plans (durations) on first run.
const seededPlans = seedDefaultPlans();

// Seed the upstream 3x-ui panel on first run so the panel works out of the box.
// Values are overridable via env; pass MYPANEL_SEED_PANEL_TOKEN="" to skip.
const SEED_PANEL_NAME = process.env.MYPANEL_SEED_PANEL_NAME || 'سرور اصلی';
const SEED_PANEL_URL =
  process.env.MYPANEL_SEED_PANEL_URL !== undefined
    ? process.env.MYPANEL_SEED_PANEL_URL
    : DEFAULT_SEED_PANEL_URL;
const SEED_PANEL_TOKEN =
  process.env.MYPANEL_SEED_PANEL_TOKEN !== undefined
    ? process.env.MYPANEL_SEED_PANEL_TOKEN
    : DEFAULT_SEED_PANEL_TOKEN;
const SEED_PANEL_INSECURE = process.env.MYPANEL_SEED_PANEL_INSECURE === 'true';

let panelLine = '';
if (SEED_PANEL_URL && SEED_PANEL_TOKEN && listPanels().length === 0) {
  try {
    createPanel({
      name: SEED_PANEL_NAME,
      baseUrl: SEED_PANEL_URL,
      apiToken: SEED_PANEL_TOKEN,
      insecure: SEED_PANEL_INSECURE,
      enabled: true,
    });
    panelLine = `  Default panel  : ${SEED_PANEL_NAME} (${SEED_PANEL_URL})`;
  } catch (e) {
    panelLine = `  Default panel  : NOT added (${e.message})`;
  }
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
  seededPlans ? `  Seeded plans   : ${seededPlans} default plans` : '',
  panelLine,
  panelLine ? '' : '',
  '  Config file    : ' + CONFIG_PATH,
  '  (Keep this file private — it holds the encryption & session keys.)',
  '======================================================================',
  '',
].filter((l) => l !== '').join('\n');

// eslint-disable-next-line no-console
console.log(out);
