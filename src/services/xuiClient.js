// Thin wrapper around the 3x-ui (Sanaei) REST API. Authenticates with a Bearer
// token and speaks the uniform { success, msg, obj } envelope.

import { httpRequest } from '../lib/fetch.js';

export class XuiApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export class XuiClient {
  constructor(baseUrl, token, { insecure = false, timeoutMs = 15000 } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.token = token;
    this.insecure = insecure;
    this.timeoutMs = timeoutMs;
  }

  async _call(method, apiPath, { body = null, form = null } = {}) {
    const url = `${this.baseUrl}${apiPath}`;
    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    };
    let payload = body;
    if (form) {
      payload = new URLSearchParams(form);
    }
    let res;
    try {
      res = await httpRequest(url, {
        method,
        headers,
        body: payload,
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      throw new XuiApiError(`Connection failed: ${err.message}`);
    }

    if (res.status === 401 || res.status === 403) {
      throw new XuiApiError('Authentication failed (check API token / base path)', res.status);
    }
    if (res.status === 404) {
      throw new XuiApiError('Endpoint not found (check the panel base URL / path)', 404);
    }
    if (res.json == null) {
      throw new XuiApiError(
        `Unexpected non-JSON response (HTTP ${res.status}). The base URL or path is probably wrong.`,
        res.status
      );
    }
    if (res.json.success === false) {
      throw new XuiApiError(res.json.msg || 'Panel returned an error', res.status);
    }
    return res.json;
  }

  // --- Server ---
  async status() {
    const r = await this._call('GET', '/panel/api/server/status');
    return r.obj;
  }

  // --- Inbounds ---
  async listInbounds() {
    const r = await this._call('GET', '/panel/api/inbounds/list');
    return r.obj || [];
  }

  async inboundOptions() {
    const r = await this._call('GET', '/panel/api/inbounds/options');
    return r.obj || [];
  }

  // --- Clients ---
  async addClient(client, inboundIds) {
    return this._call('POST', '/panel/api/clients/add', {
      body: { client, inboundIds },
    });
  }

  async getClient(email) {
    const r = await this._call('GET', `/panel/api/clients/get/${encodeURIComponent(email)}`);
    return r.obj; // { client, inboundIds }
  }

  async updateClient(email, client) {
    return this._call('POST', `/panel/api/clients/update/${encodeURIComponent(email)}`, {
      body: client,
    });
  }

  async deleteClient(email, keepTraffic = false) {
    const q = keepTraffic ? '?keepTraffic=1' : '';
    return this._call('POST', `/panel/api/clients/del/${encodeURIComponent(email)}${q}`);
  }

  async resetClientTraffic(email) {
    return this._call('POST', `/panel/api/clients/resetTraffic/${encodeURIComponent(email)}`);
  }

  async clientTraffic(email) {
    const r = await this._call('GET', `/panel/api/clients/traffic/${encodeURIComponent(email)}`);
    return r.obj;
  }

  async clientLinks(email) {
    const r = await this._call('GET', `/panel/api/clients/links/${encodeURIComponent(email)}`);
    return r.obj || [];
  }

  async subLinks(subId) {
    const r = await this._call('GET', `/panel/api/clients/subLinks/${encodeURIComponent(subId)}`);
    return r.obj || [];
  }

  async onlines() {
    const r = await this._call('POST', '/panel/api/clients/onlines');
    return r.obj || [];
  }
}

// Build a normalized health snapshot from a status() result.
export function summarizeStatus(obj) {
  if (!obj) return null;
  return {
    xrayState: obj.xray?.state || 'unknown',
    xrayVersion: obj.xray?.version || '',
    panelVersion: obj.panelVersion || '',
    cpuPct: typeof obj.cpu === 'number' ? Math.round(obj.cpu * 10) / 10 : null,
    memPct:
      obj.mem && obj.mem.total
        ? Math.round((obj.mem.current / obj.mem.total) * 1000) / 10
        : null,
    uptimeSecs: obj.uptime || 0,
    publicIp: obj.publicIP?.ipv4 || '',
  };
}
