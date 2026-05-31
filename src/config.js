// Runtime configuration loader.
//
// Non-secret + bootstrap config lives in data/config.json (created by the
// init CLI / install script). Secrets that must stay stable (session signing
// key, the AES key used to encrypt stored panel API tokens) are generated once
// and persisted there too, with the file locked down to 0600 by the installer.
//
// Environment variables override file values, which is handy for containerised
// deployments.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = process.env.MYPANEL_DATA_DIR
  ? path.resolve(process.env.MYPANEL_DATA_DIR)
  : path.join(ROOT_DIR, 'data');

export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
export const DB_PATH = path.join(DATA_DIR, 'panel.db');

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function defaultConfig() {
  return {
    // Network
    port: 2053,
    host: '0.0.0.0',
    // Reverse-proxy awareness. Only trust X-Forwarded-* when explicitly enabled.
    trustProxy: false,

    // TLS — the panel terminates HTTPS itself (no nginx/apache needed).
    tls: {
      enabled: true,
      certFile: path.join(DATA_DIR, 'certs', 'cert.pem'),
      keyFile: path.join(DATA_DIR, 'certs', 'key.pem'),
    },

    // Obscure, hard-to-guess base paths for each portal.
    adminPath: '/admin-' + randomToken(6),
    resellerPath: '/agent-' + randomToken(6),

    // Secrets (generated once).
    sessionSecret: randomToken(32),
    encryptionKey: crypto.randomBytes(32).toString('hex'), // 256-bit AES key (hex)

    // Sessions
    sessionTtlHours: 48,

    // Security knobs
    loginMaxAttempts: 6,
    loginWindowMinutes: 15,
    loginLockMinutes: 15,

    // Business rules
    maxGbPerUser: 100,
    minGbPerUser: 1,
  };
}

let cached = null;

export function loadConfig() {
  if (cached) return cached;

  let fileCfg = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (err) {
      throw new Error(`Invalid config file at ${CONFIG_PATH}: ${err.message}`);
    }
  }

  const cfg = { ...defaultConfig(), ...fileCfg };
  cfg.tls = { ...defaultConfig().tls, ...(fileCfg.tls || {}) };

  // Environment overrides
  if (process.env.MYPANEL_PORT) cfg.port = parseInt(process.env.MYPANEL_PORT, 10);
  if (process.env.MYPANEL_HOST) cfg.host = process.env.MYPANEL_HOST;
  if (process.env.MYPANEL_TRUST_PROXY) cfg.trustProxy = process.env.MYPANEL_TRUST_PROXY === 'true';
  if (process.env.MYPANEL_ADMIN_PATH) cfg.adminPath = normalizePath(process.env.MYPANEL_ADMIN_PATH);
  if (process.env.MYPANEL_RESELLER_PATH) cfg.resellerPath = normalizePath(process.env.MYPANEL_RESELLER_PATH);

  cfg.adminPath = normalizePath(cfg.adminPath);
  cfg.resellerPath = normalizePath(cfg.resellerPath);

  if (cfg.adminPath === cfg.resellerPath) {
    throw new Error('adminPath and resellerPath must be different');
  }

  cached = cfg;
  return cfg;
}

export function normalizePath(p) {
  if (!p) return p;
  let s = String(p).trim();
  if (!s.startsWith('/')) s = '/' + s;
  // strip trailing slash (but keep root)
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

export function saveConfig(cfg) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* best-effort on platforms without chmod */
  }
  cached = null;
}

export function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}
