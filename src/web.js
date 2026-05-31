// Serves the SPA HTML shell and static assets for each portal. The portal base
// path is injected via <meta> tags (no inline script needed, keeping the CSP
// strict with script-src 'self').

import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './config.js';

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const cache = new Map();

function readPublic(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const full = path.join(PUBLIC_DIR, rel);
  // prevent path traversal
  if (!full.startsWith(PUBLIC_DIR)) return null;
  if (!fs.existsSync(full)) return null;
  const buf = fs.readFileSync(full);
  cache.set(rel, buf);
  return buf;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function renderPage(portal, basePath) {
  const title = portal === 'admin' ? 'پنل مدیریت نمایندگان' : 'پرتال نمایندگی';
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="color-scheme" content="dark light" />
  <meta name="robots" content="noindex,nofollow" />
  <meta name="mp-base" content="${esc(basePath)}" />
  <meta name="mp-portal" content="${esc(portal)}" />
  <title>${esc(title)}</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230ea5a4'/%3E%3Cpath d='M9 21V11l7 5 7-5v10' stroke='white' stroke-width='2.4' fill='none' stroke-linejoin='round' stroke-linecap='round'/%3E%3C/svg%3E" />
  <link rel="stylesheet" href="${esc(basePath)}/style.css" />
</head>
<body>
  <div id="app" class="app-loading"><div class="spinner"></div></div>
  <div id="toast-wrap" class="toast-wrap"></div>
  <div id="modal-root"></div>
  <script src="${esc(basePath)}/common.js"></script>
  <script src="${esc(basePath)}/app.js"></script>
</body>
</html>`;
}

// Returns { body, contentType } or null if not an asset route.
export function serveAsset(portal, sub) {
  let rel = null;
  if (sub === '/style.css') rel = 'assets/style.css';
  else if (sub === '/common.js') rel = 'assets/common.js';
  else if (sub === '/app.js') rel = portal === 'admin' ? 'assets/admin.js' : 'assets/reseller.js';
  if (!rel) return null;
  const buf = readPublic(rel);
  if (!buf) return null;
  const ext = path.extname(rel);
  return { body: buf, contentType: MIME[ext] || 'application/octet-stream' };
}
