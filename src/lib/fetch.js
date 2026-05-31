// Minimal HTTP(S) JSON client built on node:http(s). Gives us full control over
// TLS verification (some 3x-ui panels use self-signed certs) and timeouts
// without pulling in a dependency.

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export async function httpRequest(urlStr, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = null,
    timeoutMs = 15000,
    insecure = false,
  } = options;

  const url = new URL(urlStr);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;

  const reqHeaders = { ...headers };
  let payload = null;
  if (body != null) {
    if (typeof body === 'string') {
      payload = body;
    } else if (body instanceof URLSearchParams) {
      payload = body.toString();
      if (!reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    } else {
      payload = JSON.stringify(body);
      if (!reqHeaders['Content-Type']) reqHeaders['Content-Type'] = 'application/json';
    }
    reqHeaders['Content-Length'] = Buffer.byteLength(payload);
  }

  const opts = {
    method,
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    headers: reqHeaders,
  };
  if (isHttps) opts.rejectUnauthorized = !insecure;

  return new Promise((resolve, reject) => {
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let json = null;
        const ct = res.headers['content-type'] || '';
        if (ct.includes('application/json')) {
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
        } else if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });

    if (payload != null) req.write(payload);
    req.end();
  });
}
