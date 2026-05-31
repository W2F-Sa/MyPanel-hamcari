/* Admin portal SPA. */
(function () {
  'use strict';
  const { api, toast, modal, confirmDialog, ICON, esc, money, faNum, fmtBytes, fmtDate, copy, timeAgo } = window.MP;
  const app = document.getElementById('app');
  let ME = null;
  let VIEW = 'dashboard';
  let panelsCache = [];

  // ---------- bootstrap ----------
  async function boot() {
    try {
      const me = await api('GET', '/api/me');
      if (me && me.authenticated) {
        ME = me.identity;
        renderShell();
      } else {
        renderLogin();
      }
    } catch (e) {
      renderLogin();
    }
  }

  // ---------- login ----------
  function renderLogin() {
    app.className = '';
    app.innerHTML = `
      <div class="auth">
        <form class="auth-card" id="login-form">
          <div class="brand-mark">${ICON.server}</div>
          <h1>پنل مدیریت</h1>
          <p class="sub">برای ورود، نام کاربری و رمز عبور مدیر را وارد کنید.</p>
          <div class="field">
            <label>نام کاربری</label>
            <input class="input" name="username" autocomplete="username" required />
          </div>
          <div class="field">
            <label>رمز عبور</label>
            <input class="input" name="password" type="password" autocomplete="current-password" required />
          </div>
          <button class="btn btn-primary" style="width:100%" type="submit">ورود</button>
          <div class="flex" style="justify-content:center;margin-top:16px">
            <button type="button" class="btn btn-ghost btn-sm" id="theme-toggle">${ICON.moon}<span>تغییر تم</span></button>
          </div>
        </form>
      </div>`;
    document.getElementById('theme-toggle').onclick = () => MP.toggleTheme();
    document.getElementById('login-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const r = await api('POST', '/api/login', {
          username: f.username.value.trim(),
          password: f.password.value,
        });
        ME = r.identity;
        toast('خوش آمدید', 'ok');
        renderShell();
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
      }
    };
  }

  // ---------- shell ----------
  const NAV = [
    { id: 'dashboard', label: 'داشبورد', icon: 'dash' },
    { id: 'panels', label: 'پنل‌ها', icon: 'server' },
    { id: 'resellers', label: 'نمایندگان', icon: 'users' },
    { id: 'users', label: 'کاربران', icon: 'user' },
    { id: 'audit', label: 'گزارش فعالیت', icon: 'log' },
    { id: 'settings', label: 'تنظیمات', icon: 'gear' },
  ];

  function renderShell() {
    app.className = '';
    const isDark = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark';
    app.innerHTML = `
      <div class="shell">
        <aside class="sidebar" id="sidebar">
          <div class="sb-brand">
            <div class="brand-mark">${ICON.server}</div>
            <div><b>مدیریت نمایندگان</b><small>پنل مدیر</small></div>
          </div>
          ${NAV.map((n) => navItem(n)).join('')}
          <div class="nav-sep"></div>
          <div class="nav-item" data-act="theme">${ICON.sun}<span>روز / شب</span></div>
          <div class="nav-item" data-act="logout">${ICON.logout}<span>خروج</span></div>
        </aside>
        <div class="sb-overlay" id="sb-overlay" style="display:none"></div>
        <main class="main">
          <div class="topbar">
            <button class="btn icon-btn btn-ghost menu-btn" id="menu-btn">${ICON.menu}</button>
            <h2 id="view-title">داشبورد</h2>
            <div class="grow"></div>
            <span class="badge">${esc(ME.username || 'admin')}</span>
          </div>
          <div class="content" id="view-content"><div class="spinner"></div></div>
        </main>
      </div>`;

    app.querySelectorAll('.nav-item[data-view]').forEach((el) => {
      el.onclick = () => { go(el.dataset.view); closeSidebar(); };
    });
    app.querySelector('[data-act="theme"]').onclick = () => MP.toggleTheme();
    app.querySelector('[data-act="logout"]').onclick = logout;
    document.getElementById('menu-btn').onclick = () => {
      document.getElementById('sidebar').classList.toggle('open');
      const ov = document.getElementById('sb-overlay');
      ov.style.display = document.getElementById('sidebar').classList.contains('open') ? 'block' : 'none';
    };
    document.getElementById('sb-overlay').onclick = closeSidebar;
    go(VIEW);
  }
  function closeSidebar() {
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.remove('open');
    const ov = document.getElementById('sb-overlay');
    if (ov) ov.style.display = 'none';
  }
  function navItem(n) {
    return `<div class="nav-item ${n.id === VIEW ? 'active' : ''}" data-view="${n.id}">${ICON[n.icon]}<span>${n.label}</span></div>`;
  }
  function setActive() {
    app.querySelectorAll('.nav-item[data-view]').forEach((el) => {
      el.classList.toggle('active', el.dataset.view === VIEW);
    });
    const t = NAV.find((n) => n.id === VIEW);
    const title = document.getElementById('view-title');
    if (t && title) title.textContent = t.label;
  }
  async function go(view) {
    VIEW = view;
    setActive();
    const c = document.getElementById('view-content');
    c.innerHTML = '<div class="spinner"></div>';
    try {
      if (view === 'dashboard') await viewDashboard(c);
      else if (view === 'panels') await viewPanels(c);
      else if (view === 'resellers') await viewResellers(c);
      else if (view === 'users') await viewUsers(c);
      else if (view === 'audit') await viewAudit(c);
      else if (view === 'settings') await viewSettings(c);
    } catch (err) {
      if (err.unauthorized) return renderLogin();
      c.innerHTML = `<div class="card"><div class="empty">${esc(err.message)}</div></div>`;
    }
  }
  async function logout() {
    try { await api('POST', '/api/logout'); } catch (e) {}
    ME = null;
    renderLogin();
  }

  // ---------- Dashboard ----------
  async function viewDashboard(c) {
    const d = await api('GET', '/api/dashboard');
    const stat = (lbl, val, sub) => `<div class="stat"><div class="lbl">${lbl}</div><div class="val">${val}${sub ? ` <small>${sub}</small>` : ''}</div></div>`;
    c.innerHTML = `
      <div class="grid stats">
        ${stat('نمایندگان', faNum(d.resellerCount))}
        ${stat('کاربران', faNum(d.userCount))}
        ${stat('پنل‌ها', faNum(d.panelCount))}
        ${stat('حجم فروخته‌شده', faNum(d.gbSold), 'گیگ')}
        ${stat('درآمد کل', money(d.revenue))}
        ${stat('مجموع اعتبار نمایندگان', money(d.outstandingBalance))}
      </div>
      <div class="card">
        <div class="card-h">${ICON.server}<h3>وضعیت پنل‌ها</h3><div class="grow"></div>
          <button class="btn btn-sm" id="goto-panels">مدیریت پنل‌ها</button></div>
        <div class="tbl-wrap">${panelsTable(d.panels)}</div>
      </div>`;
    document.getElementById('goto-panels').onclick = () => go('panels');
    bindPanelRowActions(c, () => go('dashboard'));
  }

  function panelsTable(panels) {
    if (!panels || !panels.length) return `<div class="empty">${ICON.server}<div>هنوز پنلی اضافه نشده است</div></div>`;
    return `<table><thead><tr>
      <th>نام</th><th>آدرس</th><th>وضعیت</th><th>آخرین بررسی</th><th></th>
    </tr></thead><tbody>${panels.map((p) => `
      <tr>
        <td><b>${esc(p.name)}</b></td>
        <td class="mono muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${esc(p.baseUrl)}</td>
        <td>${statusBadge(p)}</td>
        <td class="muted">${p.lastChecked ? timeAgo(p.lastChecked / 1000) : '—'}</td>
        <td class="t-actions">
          <button class="btn btn-sm" data-test="${p.id}">${ICON.plug}تست</button>
        </td>
      </tr>`).join('')}</tbody></table>`;
  }
  function statusBadge(p) {
    if (p.lastStatus === 'online') return `<span class="badge on"><span class="dot on"></span>آنلاین</span>`;
    if (p.lastStatus === 'offline') return `<span class="badge off"><span class="dot off"></span>آفلاین</span>`;
    return `<span class="badge"><span class="dot"></span>نامشخص</span>`;
  }
  function bindPanelRowActions(c, refresh) {
    c.querySelectorAll('[data-test]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true; b.innerHTML = ICON.refresh + 'در حال تست...';
        try {
          const r = await api('POST', `/api/panels/${b.dataset.test}/test`);
          if (r.ok) toast(`آنلاین • Xray ${r.health.xrayState} • نسخه ${r.health.panelVersion}`, 'ok');
          else toast('اتصال ناموفق: ' + r.error, 'err');
        } catch (e) { toast(e.message, 'err'); }
        refresh();
      };
    });
  }

  // ---------- Panels ----------
  async function viewPanels(c) {
    const panels = await api('GET', '/api/panels');
    panelsCache = panels;
    c.innerHTML = `
      <div class="card">
        <div class="card-h">${ICON.server}<h3>پنل‌های 3x-ui</h3><div class="grow"></div>
          <button class="btn btn-primary btn-sm" id="add-panel">${ICON.plus}افزودن پنل</button></div>
        <div class="tbl-wrap">${
          !panels.length ? `<div class="empty">${ICON.server}<div>هنوز پنلی اضافه نشده است</div></div>` :
          `<table><thead><tr><th>نام</th><th>آدرس</th><th>وضعیت</th><th>TLS</th><th></th></tr></thead><tbody>
          ${panels.map((p) => `<tr>
            <td><b>${esc(p.name)}</b></td>
            <td class="mono muted" style="max-width:260px;overflow:hidden;text-overflow:ellipsis">${esc(p.baseUrl)}</td>
            <td>${statusBadge(p)}</td>
            <td>${p.insecure ? '<span class="badge warn">بدون اعتبارسنجی</span>' : '<span class="badge">امن</span>'}</td>
            <td class="t-actions">
              <button class="btn btn-sm" data-test="${p.id}">${ICON.plug}تست</button>
              <button class="btn btn-sm" data-inb="${p.id}">${ICON.link}اینباندها</button>
              <button class="btn btn-sm icon-btn" data-edit="${p.id}" title="ویرایش">${ICON.edit}</button>
              <button class="btn btn-sm icon-btn btn-ghost" data-del="${p.id}" title="حذف">${ICON.trash}</button>
            </td></tr>`).join('')}
          </tbody></table>`
        }</div>
      </div>`;
    document.getElementById('add-panel').onclick = () => panelModal(null);
    bindPanelRowActions(c, () => go('panels'));
    c.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => panelModal(panels.find((x) => x.id == b.dataset.edit)));
    c.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      const p = panels.find((x) => x.id == b.dataset.del);
      if (await confirmDialog('حذف پنل', `پنل «${p.name}» حذف شود؟`)) {
        try { await api('POST', `/api/panels/${p.id}/delete`); toast('پنل حذف شد', 'ok'); go('panels'); }
        catch (e) { toast(e.message, 'err'); }
      }
    });
    c.querySelectorAll('[data-inb]').forEach((b) => b.onclick = () => showInbounds(b.dataset.inb));
  }

  async function showInbounds(panelId) {
    try {
      const inb = await api('GET', `/api/panels/${panelId}/inbounds`);
      await modal({
        title: 'اینباندهای پنل',
        bodyHtml: !inb.length ? `<div class="empty">اینباندی یافت نشد</div>` :
          `<div class="tbl-wrap"><table><thead><tr><th>ID</th><th>نام</th><th>پروتکل</th><th>پورت</th></tr></thead><tbody>
          ${inb.map((i) => `<tr><td><b>${i.id}</b></td><td>${esc(i.remark)}</td><td><span class="badge">${esc(i.protocol)}</span></td><td class="mono">${i.port}</td></tr>`).join('')}
          </tbody></table></div>
          <p class="hint">هنگام ساخت نماینده می‌توانید این اینباندها را برای فروش انتخاب کنید.</p>`,
      });
    } catch (e) { toast(e.message, 'err'); }
  }

  function panelModal(p) {
    const isEdit = !!p;
    modal({
      title: isEdit ? 'ویرایش پنل' : 'افزودن پنل',
      bodyHtml: `
        <form id="panel-form">
          <div class="field"><label>نام نمایشی</label><input class="input" name="name" value="${esc(p?.name || '')}" required placeholder="مثلاً سرور اصلی" /></div>
          <div class="field"><label>آدرس کامل پنل (با مسیر و پورت)</label>
            <input class="input mono" name="baseUrl" value="${esc(p?.baseUrl || '')}" required placeholder="https://host:2087/AbCdEf" dir="ltr" /></div>
          <div class="field"><label>توکن API ${isEdit ? '(برای تغییر، مقدار جدید وارد کنید)' : ''}</label>
            <input class="input mono" name="apiToken" ${isEdit ? '' : 'required'} placeholder="${isEdit ? '••••••••' : 'Bearer token'}" dir="ltr" /></div>
          <label class="switch field" style="display:flex"><input type="checkbox" name="insecure" ${p?.insecure ? 'checked' : ''}/><span class="track"></span><span>اجازه‌ی گواهی self-signed (TLS بدون اعتبارسنجی)</span></label>
          <div id="panel-test-result"></div>
        </form>`,
      footHtml: `
        <button class="btn btn-primary" id="panel-save">${isEdit ? 'ذخیره' : 'افزودن'}</button>
        <button class="btn" id="panel-test">${ICON.plug}تست اتصال</button>
        <button class="btn btn-ghost" data-close>انصراف</button>`,
    });
    const back = modal._last;
    const form = back.querySelector('#panel-form');
    const getBody = () => ({
      name: form.name.value.trim(),
      baseUrl: form.baseUrl.value.trim(),
      apiToken: form.apiToken.value.trim(),
      insecure: form.insecure.checked,
    });
    back.querySelector('#panel-test').onclick = async () => {
      const r = back.querySelector('#panel-test-result');
      r.innerHTML = '<div class="hint">در حال تست...</div>';
      try {
        const res = await api('POST', '/api/panels/test', getBody());
        if (res.ok) r.innerHTML = `<div class="cost-line"><span>${ICON.check} اتصال موفق</span><b>Xray ${esc(res.health.xrayState)} • نسخه ${esc(res.health.panelVersion)}</b></div>`;
        else r.innerHTML = `<div class="cost-line" style="background:rgba(244,63,94,.12)"><span>اتصال ناموفق</span><b style="color:#fb7185">${esc(res.error)}</b></div>`;
      } catch (e) { r.innerHTML = `<div class="hint" style="color:#fb7185">${esc(e.message)}</div>`; }
    };
    back.querySelector('#panel-save').onclick = async () => {
      const body = getBody();
      if (isEdit && !body.apiToken) delete body.apiToken;
      try {
        if (isEdit) await api('POST', `/api/panels/${p.id}`, body);
        else await api('POST', '/api/panels', body);
        toast(isEdit ? 'پنل به‌روزرسانی شد' : 'پنل افزوده شد', 'ok');
        back._close(true); go('panels');
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  // ---------- Resellers ----------
  async function viewResellers(c) {
    const list = await api('GET', '/api/resellers');
    c.innerHTML = `
      <div class="card">
        <div class="card-h">${ICON.users}<h3>نمایندگان</h3><div class="grow"></div>
          <button class="btn btn-primary btn-sm" id="add-reseller">${ICON.plus}نماینده جدید</button></div>
        <div class="tbl-wrap">${
          !list.length ? `<div class="empty">${ICON.users}<div>هنوز نماینده‌ای ساخته نشده است</div></div>` :
          `<table><thead><tr>
            <th>نام</th><th>یوزرنیم</th><th>قیمت هر گیگ</th><th>اعتبار</th><th>کاربران</th><th>وضعیت</th><th></th>
          </tr></thead><tbody>${list.map((r) => `<tr>
            <td><b>${esc(r.name)}</b></td>
            <td class="mono muted">${esc(r.username || '—')}</td>
            <td class="nowrap">${money(r.pricePerGb)}</td>
            <td class="nowrap"><b style="color:var(--brand-3)">${money(r.balance)}</b></td>
            <td>${faNum(r.userCount)}</td>
            <td>${r.enabled ? '<span class="badge on">فعال</span>' : '<span class="badge off">غیرفعال</span>'}</td>
            <td class="t-actions">
              <button class="btn btn-sm" data-bal="${r.id}">${ICON.wallet}شارژ</button>
              <button class="btn btn-sm" data-users="${r.id}">${ICON.user}کاربران</button>
              <button class="btn btn-sm icon-btn" data-edit="${r.id}" title="ویرایش">${ICON.edit}</button>
              <button class="btn btn-sm icon-btn" data-token="${r.id}" title="توکن جدید">${ICON.key}</button>
              <button class="btn btn-sm icon-btn btn-ghost" data-del="${r.id}" title="حذف">${ICON.trash}</button>
            </td></tr>`).join('')}</tbody></table>`
        }</div>
      </div>`;
    document.getElementById('add-reseller').onclick = () => resellerModal(null);
    c.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => resellerModal(list.find((x) => x.id == b.dataset.edit)));
    c.querySelectorAll('[data-bal]').forEach((b) => b.onclick = () => balanceModal(list.find((x) => x.id == b.dataset.bal)));
    c.querySelectorAll('[data-users]').forEach((b) => b.onclick = () => resellerUsers(list.find((x) => x.id == b.dataset.users)));
    c.querySelectorAll('[data-token]').forEach((b) => b.onclick = () => rotateToken(b.dataset.token));
    c.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      const r = list.find((x) => x.id == b.dataset.del);
      if (await confirmDialog('حذف نماینده', `«${r.name}» و همه‌ی کاربرانش از این پنل حذف می‌شوند. ادامه؟`)) {
        try { await api('POST', `/api/resellers/${r.id}/delete`); toast('نماینده حذف شد', 'ok'); go('resellers'); }
        catch (e) { toast(e.message, 'err'); }
      }
    });
  }

  async function resellerModal(r) {
    const isEdit = !!r;
    if (!panelsCache.length) { try { panelsCache = await api('GET', '/api/panels'); } catch (e) {} }
    const panelOpts = panelsCache.map((p) => `<option value="${p.id}" ${r && r.panelId == p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    modal({
      title: isEdit ? 'ویرایش نماینده' : 'نماینده جدید',
      size: 'lg',
      bodyHtml: `
        <form id="r-form">
          <div class="row-2">
            <div class="field"><label>نام نماینده</label><input class="input" name="name" value="${esc(r?.name || '')}" required /></div>
            <div class="field"><label>یوزرنیم (اختیاری، برای نام‌گذاری کاربران)</label><input class="input mono" name="username" value="${esc(r?.username || '')}" placeholder="agent1" dir="ltr" /></div>
          </div>
          <div class="row-2">
            <div class="field"><label>پنل</label><select name="panelId" id="r-panel"><option value="">— انتخاب پنل —</option>${panelOpts}</select></div>
            <div class="field"><label>قیمت هر گیگ (تومان، عدد صحیح)</label><input class="input" name="pricePerGb" type="number" step="1" min="0" inputmode="numeric" value="${r?.pricePerGb ?? 100000}" required /></div>
          </div>
          <div class="field"><label>اینباندهای مجاز برای فروش</label><div id="r-inbounds" class="chips"><span class="muted">ابتدا پنل را انتخاب کنید…</span></div></div>
          <div class="row-3">
            <div class="field"><label>سقف گیگ هر کاربر</label><input class="input" name="maxGb" type="number" step="1" min="1" value="${r?.maxGb ?? 100}" required /></div>
            <div class="field"><label>روز پیش‌فرض</label><input class="input" name="defaultDays" type="number" step="1" min="0" value="${r?.defaultDays ?? 30}" required /></div>
            <div class="field"><label>محدودیت IP پیش‌فرض</label><input class="input" name="defaultLimitIp" type="number" step="1" min="0" value="${r?.defaultLimitIp ?? 0}" /></div>
          </div>
          ${isEdit ? '' : `<div class="field"><label>اعتبار اولیه (تومان)</label><input class="input" name="balance" type="number" step="1" min="0" value="0" /></div>`}
          <div class="field"><label>یادداشت</label><textarea name="note" placeholder="اختیاری">${esc(r?.note || '')}</textarea></div>
          <label class="switch"><input type="checkbox" name="enabled" ${(!isEdit || r.enabled) ? 'checked' : ''}/><span class="track"></span><span>حساب فعال باشد</span></label>
        </form>`,
      footHtml: `<button class="btn btn-primary" id="r-save">${isEdit ? 'ذخیره' : 'ساخت نماینده'}</button><button class="btn btn-ghost" data-close>انصراف</button>`,
    });
    const back = modal._last;
    const form = back.querySelector('#r-form');
    const inbBox = back.querySelector('#r-inbounds');
    let selectedInbounds = new Set((r?.allowedInbounds || []).map(Number));

    async function loadInbounds(panelId) {
      if (!panelId) { inbBox.innerHTML = '<span class="muted">ابتدا پنل را انتخاب کنید…</span>'; return; }
      inbBox.innerHTML = '<span class="muted">در حال دریافت اینباندها…</span>';
      try {
        const inb = await api('GET', `/api/panels/${panelId}/inbounds`);
        if (!inb.length) { inbBox.innerHTML = '<span class="muted">اینباندی یافت نشد</span>'; return; }
        inbBox.innerHTML = inb.map((i) => {
          const on = selectedInbounds.has(Number(i.id));
          return `<label class="chip-pill" style="cursor:pointer;${on ? 'background:var(--brand-grad);color:#04221f' : ''}" data-inb="${i.id}">
            <input type="checkbox" value="${i.id}" ${on ? 'checked' : ''} style="display:none"/> #${i.id} · ${esc(i.remark)}
          </label>`;
        }).join('');
        inbBox.querySelectorAll('[data-inb]').forEach((lbl) => {
          lbl.onclick = (e) => {
            e.preventDefault();
            const id = Number(lbl.dataset.inb);
            const cb = lbl.querySelector('input');
            if (selectedInbounds.has(id)) { selectedInbounds.delete(id); cb.checked = false; lbl.style.background = ''; lbl.style.color = ''; }
            else { selectedInbounds.add(id); cb.checked = true; lbl.style.background = 'var(--brand-grad)'; lbl.style.color = '#04221f'; }
          };
        });
      } catch (e) { inbBox.innerHTML = `<span class="muted" style="color:#fb7185">${esc(e.message)}</span>`; }
    }
    back.querySelector('#r-panel').onchange = (e) => { selectedInbounds = new Set(); loadInbounds(e.target.value); };
    if (r?.panelId) loadInbounds(r.panelId);

    back.querySelector('#r-save').onclick = async () => {
      const body = {
        name: form.name.value.trim(),
        username: form.username.value.trim(),
        panelId: form.panelId.value ? Number(form.panelId.value) : null,
        pricePerGb: parseInt(form.pricePerGb.value, 10),
        allowedInbounds: [...selectedInbounds],
        maxGb: parseInt(form.maxGb.value, 10),
        defaultDays: parseInt(form.defaultDays.value, 10),
        defaultLimitIp: parseInt(form.defaultLimitIp.value, 10) || 0,
        note: form.note.value.trim(),
        enabled: form.enabled.checked,
      };
      if (!isEdit) body.balance = parseInt(form.balance.value, 10) || 0;
      if (!body.panelId) return toast('یک پنل انتخاب کنید', 'err');
      if (!body.allowedInbounds.length) return toast('حداقل یک اینباند انتخاب کنید', 'err');
      try {
        if (isEdit) { await api('POST', `/api/resellers/${r.id}`, body); toast('نماینده به‌روزرسانی شد', 'ok'); back._close(true); go('resellers'); }
        else {
          const res = await api('POST', '/api/resellers', body);
          back._close(true);
          showToken(res.reseller, res.token, 'نماینده ساخته شد');
        }
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  function resellerLoginUrl() {
    // best-effort hint for the agent portal URL (admin can replace agent path)
    return location.origin;
  }

  function showToken(reseller, token, title) {
    modal({
      title: title || 'توکن ورود نماینده',
      bodyHtml: `
        <p class="hint">این توکن فقط همین یک‌بار نمایش داده می‌شود. آن را برای نماینده ارسال کنید. نماینده با همین توکن وارد پرتال نمایندگی می‌شود.</p>
        <div class="codebox"><span class="mono" id="tok-val">${esc(token)}</span>
          <button class="btn btn-sm" id="tok-copy">${ICON.copy}کپی</button></div>
        <div class="cost-line mt"><span>نماینده</span><b>${esc(reseller.name)}</b></div>`,
      footHtml: `<button class="btn btn-primary" data-close>متوجه شدم</button>`,
    });
    const back = modal._last;
    back.querySelector('#tok-copy').onclick = () => copy(token);
  }

  async function rotateToken(id) {
    if (!(await confirmDialog('توکن جدید', 'توکن قبلی باطل می‌شود و نماینده باید با توکن جدید وارد شود. ادامه؟', { danger: false, okText: 'بساز' }))) return;
    try {
      const r = await api('POST', `/api/resellers/${id}/rotate-token`);
      showToken({ name: 'نماینده' }, r.token, 'توکن جدید');
    } catch (e) { toast(e.message, 'err'); }
  }

  function balanceModal(r) {
    modal({
      title: `اعتبار: ${r.name}`,
      bodyHtml: `
        <div class="cost-line"><span>اعتبار فعلی</span><b id="cur-bal">${money(r.balance)}</b></div>
        <div class="field mt"><label>مبلغ (تومان، عدد صحیح)</label><input class="input" id="bal-amount" type="number" step="1" min="1" inputmode="numeric" placeholder="مثلاً 1000000" /></div>
        <div class="field"><label>توضیح (اختیاری)</label><input class="input" id="bal-note" /></div>`,
      footHtml: `
        <button class="btn btn-primary" id="bal-add">${ICON.plus}افزایش</button>
        <button class="btn btn-danger" id="bal-deduct">کاهش</button>
        <button class="btn btn-ghost" data-close>بستن</button>`,
    });
    const back = modal._last;
    const doOp = async (op) => {
      const amount = parseInt(back.querySelector('#bal-amount').value, 10);
      if (!amount || amount < 1) return toast('مبلغ معتبر وارد کنید', 'err');
      try {
        const res = await api('POST', `/api/resellers/${r.id}/balance`, { op, amount, note: back.querySelector('#bal-note').value.trim() });
        toast(op === 'add' ? 'اعتبار افزایش یافت' : 'اعتبار کاهش یافت', 'ok');
        back._close(true); go('resellers');
      } catch (e) { toast(e.message, 'err'); }
    };
    back.querySelector('#bal-add').onclick = () => doOp('add');
    back.querySelector('#bal-deduct').onclick = () => doOp('deduct');
  }

  async function resellerUsers(r) {
    try {
      const users = await api('GET', `/api/resellers/${r.id}/users`);
      await modal({
        title: `کاربران ${r.name}`,
        size: 'lg',
        bodyHtml: !users.length ? `<div class="empty">${ICON.user}<div>کاربری ندارد</div></div>` :
          `<div class="tbl-wrap"><table><thead><tr><th>ایمیل</th><th>گیگ</th><th>انقضا</th><th>هزینه</th></tr></thead><tbody>
          ${users.map((u) => `<tr><td class="mono">${esc(u.email)}</td><td>${faNum(u.gb)}</td><td>${fmtDate(u.expiryTime)}</td><td>${money(u.cost)}</td></tr>`).join('')}
          </tbody></table></div>`,
      });
    } catch (e) { toast(e.message, 'err'); }
  }

  // ---------- Users (global) ----------
  async function viewUsers(c) {
    const [users, resellers] = await Promise.all([api('GET', '/api/users'), api('GET', '/api/resellers')]);
    const rmap = {}; resellers.forEach((r) => (rmap[r.id] = r.name));
    c.innerHTML = `
      <div class="card">
        <div class="card-h">${ICON.user}<h3>همه‌ی کاربران</h3><div class="grow"></div>
          <button class="btn btn-sm" id="refresh-users">${ICON.refresh}به‌روزرسانی</button></div>
        <div class="tbl-wrap">${
          !users.length ? `<div class="empty">${ICON.user}<div>کاربری ساخته نشده است</div></div>` :
          `<table><thead><tr><th>ایمیل</th><th>نماینده</th><th>گیگ</th><th>انقضا</th><th>هزینه</th><th></th></tr></thead><tbody>
          ${users.map((u) => `<tr>
            <td class="mono">${esc(u.email)}</td>
            <td>${esc(rmap[u.resellerId] || '—')}</td>
            <td>${faNum(u.gb)}</td>
            <td>${fmtDate(u.expiryTime)}</td>
            <td class="nowrap">${money(u.cost)}</td>
            <td class="t-actions">
              <button class="btn btn-sm" data-info="${u.id}">${ICON.link}جزئیات</button>
              <button class="btn btn-sm icon-btn btn-ghost" data-del="${u.id}" title="حذف">${ICON.trash}</button>
            </td></tr>`).join('')}</tbody></table>`
        }</div>
      </div>`;
    document.getElementById('refresh-users').onclick = () => go('users');
    c.querySelectorAll('[data-info]').forEach((b) => b.onclick = () => userDetails(b.dataset.info, true));
    c.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      if (await confirmDialog('حذف کاربر', 'این کاربر از پنل حذف شود؟')) {
        try { await api('POST', `/api/users/${b.dataset.del}/delete`, { refund: false }); toast('کاربر حذف شد', 'ok'); go('users'); }
        catch (e) { toast(e.message, 'err'); }
      }
    });
  }

  async function userDetails(id, isAdmin) {
    try {
      const d = await api('GET', `/api/users/${id}`);
      const t = d.traffic;
      await modal({
        title: d.user.email,
        size: 'lg',
        bodyHtml: `
          ${t ? `<div class="grid stats" style="margin-bottom:14px">
            <div class="stat"><div class="lbl">مصرف</div><div class="val" style="font-size:18px">${fmtBytes(t.up + t.down)}</div></div>
            <div class="stat"><div class="lbl">حجم کل</div><div class="val" style="font-size:18px">${t.total ? fmtBytes(t.total) : 'نامحدود'}</div></div>
            <div class="stat"><div class="lbl">انقضا</div><div class="val" style="font-size:16px">${fmtDate(t.expiryTime)}</div></div>
          </div>` : ''}
          <div class="sectiontitle">لینک‌های اتصال (${d.links.length})</div>
          ${d.links.length ? d.links.map((l, i) => `<div class="link-row">
            <span class="link-tag">لینک ${i + 1}</span>
            <div class="codebox"><span class="mono">${esc(l)}</span><button class="btn btn-sm" data-copy="${i}">${ICON.copy}</button></div>
          </div>`).join('') : '<div class="hint">لینکی موجود نیست</div>'}`,
        footHtml: isAdmin ? `<button class="btn btn-primary" id="u-renew">شارژ مجدد</button><button class="btn btn-ghost" data-close>بستن</button>` : `<button class="btn btn-ghost" data-close>بستن</button>`,
      });
      const back = modal._last;
      back.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => copy(d.links[Number(b.dataset.copy)]));
      const rn = back.querySelector('#u-renew');
      if (rn) rn.onclick = () => { back._close(); renewModal(d.user, true); };
    } catch (e) { toast(e.message, 'err'); }
  }

  function renewModal(user, isAdmin) {
    modal({
      title: `شارژ مجدد: ${user.email}`,
      bodyHtml: `
        <div class="row-2">
          <div class="field"><label>افزودن گیگ</label><input class="input" id="add-gb" type="number" step="1" min="0" value="0" /></div>
          <div class="field"><label>افزودن روز</label><input class="input" id="add-days" type="number" step="1" min="0" value="0" /></div>
        </div>
        <p class="hint">اعداد باید صحیح باشند. هزینه‌ی گیگ اضافه از اعتبار نماینده کسر می‌شود.</p>`,
      footHtml: `<button class="btn btn-primary" id="renew-go">اعمال</button><button class="btn btn-ghost" data-close>انصراف</button>`,
    });
    const back = modal._last;
    back.querySelector('#renew-go').onclick = async () => {
      const addGb = parseInt(back.querySelector('#add-gb').value, 10) || 0;
      const addDays = parseInt(back.querySelector('#add-days').value, 10) || 0;
      if (!addGb && !addDays) return toast('مقداری وارد کنید', 'err');
      try {
        await api('POST', `/api/users/${user.id}/renew`, { addGb, addDays });
        toast('کاربر به‌روزرسانی شد', 'ok'); back._close(true); go('users');
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  // ---------- Audit ----------
  async function viewAudit(c) {
    const rows = await api('GET', '/api/audit');
    c.innerHTML = `<div class="card">
      <div class="card-h">${ICON.log}<h3>گزارش فعالیت</h3></div>
      <div class="tbl-wrap">${
        !rows.length ? `<div class="empty">رکوردی نیست</div>` :
        `<table><thead><tr><th>زمان</th><th>کاربر</th><th>عملیات</th><th>جزئیات</th><th>IP</th></tr></thead><tbody>
        ${rows.map((a) => `<tr><td class="nowrap muted">${fmtDateTime(a.created_at)}</td><td class="mono">${esc(a.actor)}</td><td><span class="badge">${esc(a.action)}</span></td><td class="muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${esc(a.detail)}</td><td class="mono muted">${esc(a.ip)}</td></tr>`).join('')}
        </tbody></table>`
      }</div></div>`;
  }
  function fmtDateTime(ms) {
    try { return new Date(Number(ms)).toLocaleString('fa-IR'); } catch (e) { return ''; }
  }

  // ---------- Settings ----------
  async function viewSettings(c) {
    c.innerHTML = `<div class="card" style="max-width:520px">
      <div class="card-h">${ICON.gear}<h3>تغییر رمز عبور و نام کاربری</h3></div>
      <form id="pw-form">
        <div class="field"><label>رمز عبور فعلی</label><input class="input" name="oldPassword" type="password" required /></div>
        <div class="field"><label>نام کاربری جدید (اختیاری)</label><input class="input" name="newUsername" placeholder="${esc(ME.username)}" dir="ltr" /></div>
        <div class="field"><label>رمز عبور جدید (حداقل ۸ کاراکتر)</label><input class="input" name="newPassword" type="password" required /></div>
        <button class="btn btn-primary" type="submit">ذخیره</button>
      </form></div>`;
    document.getElementById('pw-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api('POST', '/api/change-password', {
          oldPassword: f.oldPassword.value,
          newUsername: f.newUsername.value.trim(),
          newPassword: f.newPassword.value,
        });
        toast('انجام شد. لطفاً دوباره وارد شوید.', 'ok');
        setTimeout(logout, 1200);
      } catch (err) { toast(err.message, 'err'); }
    };
  }

  boot();
})();
