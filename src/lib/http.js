// Tiny zero-dependency HTTP framework built on node:http(s): routing with
// path params, body parsing (JSON + urlencoded), cookie helpers and a request
// context object. Keeps the runtime free of web-framework dependencies.

import { URL } from 'node:url';

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

export class HttpError extends Error {
  constructor(status, message, obj = null) {
    super(message);
    this.status = status;
    this.obj = obj;
  }
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseBody(raw, contentType) {
  if (!raw || raw.length === 0) return {};
  const ct = (contentType || '').toLowerCase();
  const text = raw.toString('utf8');
  if (ct.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, 'Invalid JSON body');
    }
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    const obj = {};
    const params = new URLSearchParams(text);
    for (const [k, v] of params) obj[k] = v;
    return obj;
  }
  // Fallback: try JSON, else raw text
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

export class Context {
  constructor(req, res, cfg) {
    this.req = req;
    this.res = res;
    this.cfg = cfg;
    const proto = 'https';
    this.url = new URL(req.url, `${proto}://${req.headers.host || 'localhost'}`);
    this.path = this.url.pathname;
    this.method = req.method.toUpperCase();
    this.query = Object.fromEntries(this.url.searchParams.entries());
    this.params = {};
    this.cookies = parseCookies(req.headers.cookie);
    this.body = {};
    this.session = null;
    this.state = {};
    this._headers = {};
    this._status = 200;
  }

  clientIp() {
    if (this.cfg.trustProxy) {
      const xff = this.req.headers['x-forwarded-for'];
      if (xff) return String(xff).split(',')[0].trim();
    }
    return this.req.socket.remoteAddress || '';
  }

  status(code) {
    this._status = code;
    return this;
  }

  setHeader(name, value) {
    this._headers[name] = value;
    return this;
  }

  setCookie(name, value, opts = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    if (opts.maxAge != null) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
    if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
    parts.push(`Path=${opts.path || '/'}`);
    if (opts.httpOnly !== false) parts.push('HttpOnly');
    if (opts.secure !== false) parts.push('Secure');
    parts.push(`SameSite=${opts.sameSite || 'Strict'}`);
    const prev = this.res.getHeader('Set-Cookie');
    const cookie = parts.join('; ');
    if (prev) {
      this.res.setHeader('Set-Cookie', Array.isArray(prev) ? [...prev, cookie] : [prev, cookie]);
    } else {
      this.res.setHeader('Set-Cookie', cookie);
    }
    return this;
  }

  clearCookie(name, opts = {}) {
    this.setCookie(name, '', { ...opts, maxAge: 0 });
  }

  _applyHeaders() {
    for (const [k, v] of Object.entries(this._headers)) this.res.setHeader(k, v);
  }

  json(obj, status) {
    if (status) this._status = status;
    this._applyHeaders();
    const data = JSON.stringify(obj);
    this.res.writeHead(this._status, { 'Content-Type': 'application/json; charset=utf-8' });
    this.res.end(data);
  }

  // 3x-ui style envelope helpers
  ok(obj = null, msg = '') {
    this.json({ success: true, msg, obj });
  }

  fail(msg = 'error', status = 400, obj = null) {
    this.json({ success: false, msg, obj }, status);
  }

  text(str, status) {
    if (status) this._status = status;
    this._applyHeaders();
    this.res.writeHead(this._status, { 'Content-Type': 'text/plain; charset=utf-8' });
    this.res.end(str);
  }

  html(str, status) {
    if (status) this._status = status;
    this._applyHeaders();
    this.res.writeHead(this._status, { 'Content-Type': 'text/html; charset=utf-8' });
    this.res.end(str);
  }

  redirect(location, status = 302) {
    this._applyHeaders();
    this.res.writeHead(status, { Location: location });
    this.res.end();
  }
}

export class Router {
  constructor() {
    this.routes = [];
    this.middlewares = [];
  }

  use(fn) {
    this.middlewares.push(fn);
    return this;
  }

  add(method, pattern, ...handlers) {
    const keys = [];
    const regexStr = pattern
      .replace(/\/+$/, '')
      .replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === '*' ? '.*' : '\\' + m))
      .replace(/:(\w+)/g, (_, key) => {
        keys.push(key);
        return '([^/]+)';
      });
    const regex = new RegExp('^' + (regexStr || '') + '/?$');
    this.routes.push({ method, regex, keys, handlers });
    return this;
  }

  get(p, ...h) {
    return this.add('GET', p, ...h);
  }
  post(p, ...h) {
    return this.add('POST', p, ...h);
  }

  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.regex.exec(pathname);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => {
          params[k] = decodeURIComponent(m[i + 1]);
        });
        return { route: r, params };
      }
    }
    return null;
  }
}

// Build the main request handler from a base path + router.
export function createHandler(cfg, dispatch) {
  return async (req, res) => {
    const ctx = new Context(req, res, cfg);
    try {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(ctx.method)) {
        const raw = await readBody(req);
        ctx.rawBody = raw;
        ctx.body = parseBody(raw, req.headers['content-type']);
      }
      await dispatch(ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        ctx.fail(err.message, err.status, err.obj);
      } else {
        // Avoid leaking internals
        // eslint-disable-next-line no-console
        console.error('[error]', err);
        if (!res.headersSent) ctx.fail('Internal server error', 500);
      }
    }
  };
}
