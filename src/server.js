// Entry point. Terminates HTTPS itself (no nginx/apache required), routes the
// two portals by their secret base paths, and applies security middleware.

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';

import { loadConfig, ensureDataDir } from './config.js';
import { getDb } from './lib/db.js';
import { createHandler } from './lib/http.js';
import { applySecurityHeaders, enforceCsrf, cleanupLoginAttempts } from './lib/security.js';
import { resolveSession } from './middleware/auth.js';
import { cleanupSessions } from './lib/sessions.js';
import { refreshSessionIfNeeded } from './routes/helpers.js';
import { renderPage, serveAsset } from './web.js';
import { buildAdminRouter } from './routes/admin.js';
import { buildResellerRouter } from './routes/reseller.js';
import { adminExists } from './services/admin.js';

const cfg = loadConfig();
ensureDataDir();
getDb(); // init + migrate

if (!adminExists()) {
  // eslint-disable-next-line no-console
  console.error(
    '\n[FATAL] No admin account configured yet.\n' +
      'Run:  node src/cli/initConfig.js\n' +
      '(the installer does this automatically)\n'
  );
  process.exit(1);
}

const adminRouter = buildAdminRouter();
const resellerRouter = buildResellerRouter();

async function handlePortal(ctx, portal, base, sub, router) {
  if (!sub.startsWith('/')) sub = '/' + sub;

  // Static assets (GET only)
  if (ctx.method === 'GET') {
    const asset = serveAsset(portal, sub);
    if (asset) {
      ctx.setHeader('Cache-Control', 'public, max-age=300');
      ctx.res.writeHead(200, { 'Content-Type': asset.contentType });
      ctx.res.end(asset.body);
      return;
    }
  }

  // API
  if (sub === '/api' || sub.startsWith('/api/')) {
    const matched = router.match(ctx.method, sub);
    if (!matched) {
      ctx.fail('Not found', 404);
      return;
    }
    ctx.params = matched.params;
    enforceCsrf(ctx);
    for (const h of matched.route.handlers) {
      // eslint-disable-next-line no-await-in-loop
      await h(ctx);
      if (ctx.res.headersSent) break;
    }
    return;
  }

  // SPA shell for the portal root and any client-side route (GET).
  if (ctx.method === 'GET') {
    ctx.html(renderPage(portal, base));
    return;
  }

  ctx.fail('Not found', 404);
}

async function dispatch(ctx) {
  applySecurityHeaders(ctx);

  const p = ctx.path;
  const adminPath = cfg.adminPath;
  const resellerPath = cfg.resellerPath;

  // Determine the portal first so the session cookie (namespaced per portal)
  // is resolved against the right name and sliding-refresh can re-set it.
  if (p === adminPath || p.startsWith(adminPath + '/')) {
    ctx.portal = 'admin';
    ctx.portalBase = adminPath;
    resolveSession(ctx);
    refreshSessionIfNeeded(ctx);
    return handlePortal(ctx, 'admin', adminPath, p.slice(adminPath.length) || '/', adminRouter);
  }
  if (p === resellerPath || p.startsWith(resellerPath + '/')) {
    ctx.portal = 'reseller';
    ctx.portalBase = resellerPath;
    resolveSession(ctx);
    refreshSessionIfNeeded(ctx);
    return handlePortal(ctx, 'reseller', resellerPath, p.slice(resellerPath.length) || '/', resellerRouter);
  }

  if (p === '/healthz') {
    ctx.text('ok');
    return;
  }

  // Do not reveal anything about the panel on unknown paths.
  ctx.status(404).text('Not Found');
}

const handler = createHandler(cfg, dispatch);

let server;
const useHttp = process.env.MYPANEL_HTTP === '1' || cfg.tls.enabled === false;

if (useHttp) {
  server = http.createServer(handler);
  // eslint-disable-next-line no-console
  console.warn('[warn] Running in PLAIN HTTP mode. Use only behind a trusted TLS terminator.');
} else {
  let key;
  let cert;
  try {
    key = fs.readFileSync(cfg.tls.keyFile);
    cert = fs.readFileSync(cfg.tls.certFile);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `\n[FATAL] TLS certificate/key not found.\n` +
        `  cert: ${cfg.tls.certFile}\n  key:  ${cfg.tls.keyFile}\n` +
        `Generate a self-signed pair (the installer does this), or set MYPANEL_HTTP=1 to run plain HTTP behind a proxy.\n` +
        `Underlying error: ${err.message}\n`
    );
    process.exit(1);
  }
  server = https.createServer(
    {
      key,
      cert,
      minVersion: 'TLSv1.2',
      honorCipherOrder: true,
    },
    handler
  );
}

server.headersTimeout = 20000;
server.requestTimeout = 30000;

server.listen(cfg.port, cfg.host, () => {
  const scheme = useHttp ? 'http' : 'https';
  // eslint-disable-next-line no-console
  console.log(
    `\n  MyPanel reseller server listening on ${scheme}://${cfg.host}:${cfg.port}\n` +
      `  Admin portal:    ${scheme}://<host>:${cfg.port}${cfg.adminPath}\n` +
      `  Reseller portal: ${scheme}://<host>:${cfg.port}${cfg.resellerPath}\n`
  );
});

// periodic housekeeping
setInterval(() => {
  try {
    cleanupSessions();
    cleanupLoginAttempts();
  } catch {
    /* ignore */
  }
}, 10 * 60 * 1000).unref();

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
