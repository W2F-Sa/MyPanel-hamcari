/* Shared front-end runtime: API client (with CSRF), theming, toasts, modals,
   formatting helpers and an inline SVG icon set. No external dependencies. */
(function () {
  'use strict';

  function meta(name) {
    const el = document.querySelector(`meta[name="${name}"]`);
    return el ? el.getAttribute('content') : '';
  }

  const BASE = meta('mp-base') || '';
  const PORTAL = meta('mp-portal') || 'admin';

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  // ---- API ----
  async function api(method, path, body) {
    const opts = {
      method,
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    };
    if (body !== undefined && body !== null) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    if (!/^get$/i.test(method)) {
      const csrf = getCookie('mp_csrf');
      if (csrf) opts.headers['X-CSRF-Token'] = csrf;
    }
    let res;
    try {
      res = await fetch(BASE + path, opts);
    } catch (e) {
      throw new Error('ارتباط با سرور برقرار نشد');
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    if (res.status === 401) {
      const err = new Error((data && data.msg) || 'احراز هویت لازم است');
      err.unauthorized = true;
      throw err;
    }
    if (!data) throw new Error('پاسخ نامعتبر از سرور (HTTP ' + res.status + ')');
    if (data.success === false) {
      const err = new Error(data.msg || 'خطا');
      err.obj = data.obj;
      throw err;
    }
    return data.obj;
  }

  // ---- Theme ----
  function initTheme() {
    const saved = localStorage.getItem('mp-theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('mp-theme', next);
    return next;
  }

  // ---- Toast ----
  function toast(msg, type) {
    const wrap = document.getElementById('toast-wrap');
    if (!wrap) return;
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .3s, transform .3s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(8px)';
      setTimeout(() => t.remove(), 320);
    }, type === 'err' ? 4200 : 2800);
  }

  // ---- Modal ----
  function modal({ title, bodyHtml, footHtml, size }) {
    return new Promise((resolve) => {
      const root = document.getElementById('modal-root');
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML =
        `<div class="modal ${size || ''}" role="dialog" aria-modal="true">
           <div class="modal-h"><h3>${esc(title)}</h3><div class="grow"></div>
             <button class="btn icon-btn btn-ghost" data-close aria-label="بستن">${ICON.x}</button>
           </div>
           <div class="modal-body">${bodyHtml || ''}</div>
           ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}
         </div>`;
      root.appendChild(back);
      const close = (val) => {
        back.style.opacity = '0';
        setTimeout(() => back.remove(), 180);
        resolve(val);
      };
      back.addEventListener('click', (e) => {
        if (e.target === back) close(null);
        if (e.target.closest('[data-close]')) close(null);
      });
      const escListener = (e) => {
        if (e.key === 'Escape') {
          close(null);
          document.removeEventListener('keydown', escListener);
        }
      };
      document.addEventListener('keydown', escListener);
      back._el = back.querySelector('.modal');
      back._close = close;
      back._resolve = resolve;
      requestAnimationFrame(() => {
        const f = back.querySelector('input,select,textarea,button:not([data-close])');
        if (f) f.focus();
      });
      // expose for caller
      modal._last = back;
    });
  }

  async function confirmDialog(title, message, { danger = true, okText = 'تأیید' } = {}) {
    return new Promise((resolve) => {
      const root = document.getElementById('modal-root');
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<div class="modal" style="max-width:420px">
        <div class="modal-h"><h3>${esc(title)}</h3></div>
        <div>${esc(message)}</div>
        <div class="modal-foot">
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(okText)}</button>
          <button class="btn btn-ghost" data-cancel>انصراف</button>
        </div></div>`;
      root.appendChild(back);
      const done = (v) => { back.remove(); resolve(v); };
      back.addEventListener('click', (e) => {
        if (e.target === back || e.target.closest('[data-cancel]')) done(false);
        if (e.target.closest('[data-ok]')) done(true);
      });
    });
  }

  // ---- Formatting ----
  const faNum = (n) => {
    const x = Number(n) || 0;
    return x.toLocaleString('en-US');
  };
  const money = (n) => faNum(n) + ' تومان';
  function fmtBytes(b) {
    b = Number(b) || 0;
    if (b <= 0) return '0';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
    return (b / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
  }
  function fmtDate(ms) {
    if (!ms || ms <= 0) return 'نامحدود';
    try {
      return new Date(Number(ms)).toLocaleDateString('fa-IR', {
        year: 'numeric', month: '2-digit', day: '2-digit',
      });
    } catch (e) {
      return new Date(Number(ms)).toISOString().slice(0, 10);
    }
  }
  function timeAgo(sec) {
    if (!sec) return '—';
    const d = Date.now() / 1000 - Number(sec);
    if (d < 60) return 'لحظاتی پیش';
    if (d < 3600) return Math.floor(d / 60) + ' دقیقه پیش';
    if (d < 86400) return Math.floor(d / 3600) + ' ساعت پیش';
    return Math.floor(d / 86400) + ' روز پیش';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('کپی شد', 'ok');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('کپی شد', 'ok'); }
      catch (e2) { toast('کپی نشد', 'err'); }
      ta.remove();
    }
  }

  // ---- Icons (inline SVG, stroke=currentColor) ----
  const S = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const ICON = {
    dash: S('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
    server: S('<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>'),
    users: S('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 6.5a3 3 0 0 1 0 5.8M21 20c0-2.6-1.5-4.4-3.5-5.1"/>'),
    user: S('<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6"/>'),
    wallet: S('<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14" r="1.2"/>'),
    chart: S('<path d="M4 19V5M4 19h16"/><path d="M8 16l3-4 3 2 4-6"/>'),
    log: S('<path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 11h8M8 15h6"/>'),
    gear: S('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M5 5l2 2M17 17l2 2M2 12h3M19 12h3M5 19l2-2M17 7l2-2"/>'),
    plus: S('<path d="M12 5v14M5 12h14"/>'),
    edit: S('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/>'),
    trash: S('<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>'),
    plug: S('<path d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0V8zM12 16v6"/>'),
    copy: S('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>'),
    key: S('<circle cx="8" cy="14" r="4"/><path d="M11 11l9-9M17 5l2 2M14 8l2 2"/>'),
    x: S('<path d="M6 6l12 12M18 6L6 18"/>'),
    sun: S('<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>'),
    moon: S('<path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5z"/>'),
    menu: S('<path d="M3 6h18M3 12h18M3 18h18"/>'),
    logout: S('<path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3"/><path d="M10 8l-4 4 4 4M6 12h10"/>'),
    refresh: S('<path d="M21 12a9 9 0 1 1-2.6-6.3M21 4v5h-5"/>'),
    check: S('<path d="M5 12l4 4L19 6"/>'),
    link: S('<path d="M10 13a5 5 0 0 1 0-7l2-2a5 5 0 0 1 7 7l-1 1M14 11a5 5 0 0 1 0 7l-2 2a5 5 0 0 1-7-7l1-1"/>'),
    coin: S('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'),
  };

  window.MP = {
    BASE, PORTAL, api, toast, modal, confirmDialog,
    initTheme, toggleTheme, getCookie,
    faNum, money, fmtBytes, fmtDate, timeAgo, esc, copy, ICON,
  };
  initTheme();
})();
