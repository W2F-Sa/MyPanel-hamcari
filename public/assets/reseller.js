/* Reseller (agent) portal SPA. */
(function () {
  'use strict';
  const { api, toast, modal, confirmDialog, ICON, esc, money, faNum, fmtBytes, fmtDate, copy } = window.MP;
  const app = document.getElementById('app');
  let ME = null;
  let VIEW = 'home';
  let inboundsCache = [];

  async function boot() {
    try {
      const me = await api('GET', '/api/me');
      if (me && me.authenticated) { ME = me.identity; renderShell(); }
      else renderLogin();
    } catch (e) { renderLogin(); }
  }

  function renderLogin() {
    app.className = '';
    app.innerHTML = `
      <div class="auth">
        <form class="auth-card" id="login-form">
          <div class="brand-mark">${ICON.user}</div>
          <h1>ورود نماینده</h1>
          <p class="sub">توکن دریافتی از مدیر را وارد کنید.</p>
          <div class="field"><label>توکن نماینده</label>
            <input class="input mono" name="token" required placeholder="agent_..." dir="ltr" autocomplete="off" /></div>
          <button class="btn btn-primary" style="width:100%" type="submit">ورود</button>
          <div class="flex" style="justify-content:center;margin-top:16px">
            <button type="button" class="btn btn-ghost btn-sm" id="theme-toggle">${ICON.moon}<span>تغییر تم</span></button>
          </div>
        </form>
      </div>`;
    document.getElementById('theme-toggle').onclick = () => MP.toggleTheme();
    document.getElementById('login-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target; const btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const r = await api('POST', '/api/login', { token: f.token.value.trim() });
        ME = r.identity; toast('خوش آمدید', 'ok'); renderShell();
      } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    };
  }

  const NAV = [
    { id: 'home', label: 'داشبورد', icon: 'dash' },
    { id: 'create', label: 'ساخت کاربر', icon: 'plus' },
    { id: 'users', label: 'کاربران من', icon: 'users' },
    { id: 'tx', label: 'تراکنش‌ها', icon: 'coin' },
  ];

  function renderShell() {
    app.className = '';
    app.innerHTML = `
      <div class="shell">
        <aside class="sidebar" id="sidebar">
          <div class="sb-brand"><div class="brand-mark">${ICON.user}</div>
            <div><b>${esc(ME.name)}</b><small>پرتال نمایندگی</small></div></div>
          ${NAV.map(navItem).join('')}
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
            <span class="badge on">${ICON.wallet} ${money(ME.balance)}</span>
          </div>
          <div class="content" id="view-content"><div class="spinner"></div></div>
        </main>
      </div>`;
    app.querySelectorAll('.nav-item[data-view]').forEach((el) => el.onclick = () => { go(el.dataset.view); closeSidebar(); });
    app.querySelector('[data-act="theme"]').onclick = () => MP.toggleTheme();
    app.querySelector('[data-act="logout"]').onclick = logout;
    document.getElementById('menu-btn').onclick = () => {
      const sb = document.getElementById('sidebar'); sb.classList.toggle('open');
      document.getElementById('sb-overlay').style.display = sb.classList.contains('open') ? 'block' : 'none';
    };
    document.getElementById('sb-overlay').onclick = closeSidebar;
    go(VIEW);
  }
  function closeSidebar() {
    const sb = document.getElementById('sidebar'); if (sb) sb.classList.remove('open');
    const ov = document.getElementById('sb-overlay'); if (ov) ov.style.display = 'none';
  }
  function navItem(n) { return `<div class="nav-item ${n.id === VIEW ? 'active' : ''}" data-view="${n.id}">${ICON[n.icon]}<span>${n.label}</span></div>`; }
  function setActive() {
    app.querySelectorAll('.nav-item[data-view]').forEach((el) => el.classList.toggle('active', el.dataset.view === VIEW));
    const t = NAV.find((n) => n.id === VIEW); const title = document.getElementById('view-title');
    if (t && title) title.textContent = t.label;
  }
  function refreshBalanceBadge() {
    const b = app.querySelector('.topbar .badge');
    if (b && ME) b.innerHTML = `${ICON.wallet} ${money(ME.balance)}`;
  }
  async function go(view) {
    VIEW = view; setActive();
    const c = document.getElementById('view-content');
    c.innerHTML = '<div class="spinner"></div>';
    try {
      if (view === 'home') await viewHome(c);
      else if (view === 'create') await viewCreate(c);
      else if (view === 'users') await viewUsers(c);
      else if (view === 'tx') await viewTx(c);
    } catch (err) {
      if (err.unauthorized) return renderLogin();
      c.innerHTML = `<div class="card"><div class="empty">${esc(err.message)}</div></div>`;
    }
  }
  async function logout() { try { await api('POST', '/api/logout'); } catch (e) {} ME = null; renderLogin(); }

  // ---------- Home ----------
  async function viewHome(c) {
    const d = await api('GET', '/api/dashboard');
    ME.balance = d.profile.balance;
    refreshBalanceBadge();
    const stat = (lbl, val, sub) => `<div class="stat"><div class="lbl">${lbl}</div><div class="val">${val}${sub ? ` <small>${sub}</small>` : ''}</div></div>`;
    c.innerHTML = `
      <div class="grid stats">
        ${stat('اعتبار', money(d.profile.balance))}
        ${stat('قیمت هر گیگ', money(d.profile.pricePerGb))}
        ${stat('کاربران من', faNum(d.stats.userCount))}
        ${stat('حجم فروخته‌شده', faNum(d.stats.totalGbSold), 'گیگ')}
      </div>
      <div class="card">
        <div class="card-h">${ICON.plus}<h3>ساخت سریع کاربر</h3><div class="grow"></div>
          <button class="btn btn-primary btn-sm" id="quick-create">شروع</button></div>
        <p class="hint">با انتخاب حجم (۱ تا ${faNum(d.profile.maxGb)} گیگ) و تعداد روز، کاربر روی همه‌ی اینباندهای شما ساخته می‌شود و لینک‌ها بلافاصله آماده‌اند.</p>
      </div>
      ${d.recentUsers.length ? `<div class="card"><div class="card-h">${ICON.users}<h3>آخرین کاربران</h3></div>
        <div class="tbl-wrap"><table><thead><tr><th>ایمیل</th><th>گیگ</th><th>انقضا</th></tr></thead><tbody>
        ${d.recentUsers.map((u) => `<tr><td class="mono">${esc(u.email)}</td><td>${faNum(u.gb)}</td><td>${fmtDate(u.expiryTime)}</td></tr>`).join('')}
        </tbody></table></div></div>` : ''}`;
    document.getElementById('quick-create').onclick = () => go('create');
  }

  // ---------- Create ----------
  async function viewCreate(c) {
    let plans = [];
    try { plans = await api('GET', '/api/plans'); } catch (e) {}
    const maxGb = ME.maxGb || 100;
    const price = ME.pricePerGb || 0;
    if (!plans.length) {
      c.innerHTML = `<div class="card"><div class="empty">${ICON.coin}<div>هنوز پلنی توسط مدیر تعریف نشده است.<br>تا تعریف پلن، امکان ساخت کاربر نیست.</div></div></div>`;
      return;
    }
    const initGb = Math.min(10, maxGb);
    c.innerHTML = `
      <div class="card" style="max-width:620px">
        <div class="card-h">${ICON.plus}<h3>ساخت کاربر جدید</h3></div>
        <form id="create-form">
          <div class="field"><label>نام کاربر (اختیاری)</label><input class="input mono" name="name" placeholder="مثلاً ali یا خالی برای نام تصادفی" dir="ltr" /></div>
          <div class="field"><label>پلن (مدت‌زمان)</label>
            <select name="planId" id="plan-sel">
              ${plans.map((p) => `<option value="${p.id}">${esc(p.name)} — ${faNum(p.days)} روز</option>`).join('')}
            </select>
            <div class="hint">مدت‌زمان توسط مدیر تعیین شده است.</div>
          </div>
          <div class="field"><label>حجم (گیگابایت)</label>
            <div class="gb-pick">
              <input type="range" id="gb-range" min="1" max="${maxGb}" step="1" value="${initGb}" />
              <input class="input gb-val" id="gb-num" type="number" min="1" max="${maxGb}" step="1" value="${initGb}" style="min-width:90px" />
            </div>
            <div class="hint">حداکثر ${faNum(maxGb)} گیگ — فقط عدد صحیح</div>
          </div>
          <div class="field"><label>محدودیت IP — صفر = نامحدود</label><input class="input" name="limitIp" type="number" min="0" step="1" value="${ME.defaultLimitIp ?? 0}" /></div>
          <div class="cost-line"><span>هزینه‌ی این کاربر</span><b id="cost">${money(initGb * price)}</b></div>
          <div class="cost-line mt"><span>اعتبار باقی‌مانده پس از ساخت</span><b id="after">${money(ME.balance - initGb * price)}</b></div>
          <button class="btn btn-primary mt" type="submit" style="width:100%">${ICON.plus}ساخت کاربر</button>
        </form>
      </div>`;
    const range = c.querySelector('#gb-range');
    const num = c.querySelector('#gb-num');
    const cost = c.querySelector('#cost');
    const after = c.querySelector('#after');
    const sync = (v) => {
      let g = parseInt(v, 10); if (isNaN(g) || g < 1) g = 1; if (g > maxGb) g = maxGb;
      range.value = g; num.value = g;
      const cst = g * price;
      cost.textContent = money(cst);
      after.textContent = money(ME.balance - cst);
      after.style.color = (ME.balance - cst) < 0 ? '#fb7185' : '';
    };
    range.oninput = () => sync(range.value);
    num.oninput = () => sync(num.value);
    c.querySelector('#create-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target; const btn = f.querySelector('button[type=submit]');
      const gb = parseInt(num.value, 10);
      const planId = parseInt(f.planId.value, 10);
      const limitIp = parseInt(f.limitIp.value, 10) || 0;
      if (!gb || gb < 1) return toast('حجم معتبر وارد کنید', 'err');
      if (!planId) return toast('یک پلن انتخاب کنید', 'err');
      if (gb * price > ME.balance) return toast('اعتبار کافی نیست', 'err');
      btn.disabled = true; btn.innerHTML = ICON.refresh + 'در حال ساخت...';
      try {
        const r = await api('POST', '/api/users', { name: f.name.value.trim(), gb, planId, limitIp });
        try { const me = await api('GET', '/api/me'); ME = me.identity; refreshBalanceBadge(); } catch (e2) {}
        showCreated(r.user, r.links);
      } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.innerHTML = ICON.plus + 'ساخت کاربر'; }
    };
  }

  function showCreated(user, links) {
    modal({
      title: 'کاربر ساخته شد ✓',
      size: 'lg',
      bodyHtml: `
        <div class="cost-line"><span>ایمیل</span><b class="mono">${esc(user.email)}</b></div>
        <div class="sectiontitle">لینک‌های اتصال (${links.length})</div>
        ${links.length ? links.map((l, i) => `<div class="link-row">
          <span class="link-tag">لینک ${i + 1}</span>
          <div class="codebox"><span class="mono">${esc(l)}</span><button class="btn btn-sm" data-copy="${i}">${ICON.copy}</button></div>
        </div>`).join('') : '<div class="hint">لینک‌ها در حال آماده‌سازی‌اند؛ از بخش «کاربران من» دوباره بررسی کنید.</div>'}
        ${links.length ? `<button class="btn mt" id="copy-all">${ICON.copy}کپی همه‌ی لینک‌ها</button>` : ''}`,
      footHtml: `<button class="btn btn-primary" data-close>پایان</button>`,
    });
    const back = modal._last;
    back.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => copy(links[Number(b.dataset.copy)]));
    const ca = back.querySelector('#copy-all'); if (ca) ca.onclick = () => copy(links.join('\n'));
    back._resolve && (back._onclose = () => go('users'));
    // ensure navigation after close
    const obs = new MutationObserver(() => { if (!document.body.contains(back)) { obs.disconnect(); go('users'); } });
    obs.observe(document.getElementById('modal-root'), { childList: true });
  }

  // ---------- Users ----------
  async function viewUsers(c) {
    const users = await api('GET', '/api/users');
    c.innerHTML = `<div class="card">
      <div class="card-h">${ICON.users}<h3>کاربران من</h3><div class="grow"></div>
        <button class="btn btn-primary btn-sm" id="new-user">${ICON.plus}کاربر جدید</button></div>
      <div class="tbl-wrap">${
        !users.length ? `<div class="empty">${ICON.users}<div>هنوز کاربری نساخته‌اید</div></div>` :
        `<table><thead><tr><th>ایمیل</th><th>پلن</th><th>گیگ</th><th>انقضا</th><th>هزینه</th><th></th></tr></thead><tbody>
        ${users.map((u) => `<tr>
          <td class="mono">${esc(u.email)}</td>
          <td>${u.planName ? `<span class="badge">${esc(u.planName)}</span>` : '—'}</td>
          <td>${faNum(u.gb)}</td>
          <td>${fmtDate(u.expiryTime)}</td>
          <td class="nowrap">${money(u.cost)}</td>
          <td class="t-actions">
            <button class="btn btn-sm" data-info="${u.id}">${ICON.link}لینک‌ها</button>
            <button class="btn btn-sm" data-renew="${u.id}">${ICON.coin}شارژ</button>
            <button class="btn btn-sm icon-btn btn-ghost" data-del="${u.id}" title="حذف">${ICON.trash}</button>
          </td></tr>`).join('')}</tbody></table>`
      }</div></div>`;
    document.getElementById('new-user').onclick = () => go('create');
    c.querySelectorAll('[data-info]').forEach((b) => b.onclick = () => userLinks(b.dataset.info));
    c.querySelectorAll('[data-renew]').forEach((b) => b.onclick = () => renewModal(b.dataset.renew));
    c.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      if (await confirmDialog('حذف کاربر', 'این کاربر حذف شود؟')) {
        try { await api('POST', `/api/users/${b.dataset.del}/delete`); toast('کاربر حذف شد', 'ok'); go('users'); }
        catch (e) { toast(e.message, 'err'); }
      }
    });
  }

  async function userLinks(id) {
    try {
      const d = await api('GET', `/api/users/${id}`);
      const t = d.traffic;
      await modal({
        title: d.user.email, size: 'lg',
        bodyHtml: `
          ${t ? `<div class="grid stats" style="margin-bottom:14px">
            <div class="stat"><div class="lbl">مصرف</div><div class="val" style="font-size:18px">${fmtBytes(t.up + t.down)}</div></div>
            <div class="stat"><div class="lbl">حجم کل</div><div class="val" style="font-size:18px">${t.total ? fmtBytes(t.total) : 'نامحدود'}</div></div>
            <div class="stat"><div class="lbl">انقضا</div><div class="val" style="font-size:16px">${fmtDate(t.expiryTime)}</div></div>
          </div>` : ''}
          <div class="sectiontitle">لینک‌های اتصال (${d.links.length})</div>
          ${d.links.length ? d.links.map((l, i) => `<div class="link-row"><span class="link-tag">لینک ${i + 1}</span>
            <div class="codebox"><span class="mono">${esc(l)}</span><button class="btn btn-sm" data-copy="${i}">${ICON.copy}</button></div></div>`).join('')
            + `<button class="btn mt" id="copy-all">${ICON.copy}کپی همه</button>` : '<div class="hint">لینکی موجود نیست</div>'}`,
        footHtml: `<button class="btn btn-ghost" data-close>بستن</button>`,
      });
      const back = modal._last;
      back.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => copy(d.links[Number(b.dataset.copy)]));
      const ca = back.querySelector('#copy-all'); if (ca) ca.onclick = () => copy(d.links.join('\n'));
    } catch (e) { toast(e.message, 'err'); }
  }

  async function renewModal(id) {
    const price = ME.pricePerGb || 0;
    let plans = [];
    try { plans = await api('GET', '/api/plans'); } catch (e) {}
    modal({
      title: 'شارژ مجدد کاربر',
      bodyHtml: `
        <div class="field"><label>تمدید مدت (پلن) — اختیاری</label>
          <select id="renew-plan">
            <option value="">— بدون تمدید زمان —</option>
            ${plans.map((p) => `<option value="${p.id}">${esc(p.name)} — ${faNum(p.days)} روز</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>افزودن حجم (گیگ)</label><input class="input" id="add-gb" type="number" min="0" step="1" value="0" /></div>
        <div class="cost-line"><span>هزینه</span><b id="rcost">${money(0)}</b></div>
        <p class="hint">اعداد صحیح. هزینه فقط بابت حجم اضافه‌شده است؛ مدت‌زمان از پلن انتخاب می‌شود.</p>`,
      footHtml: `<button class="btn btn-primary" id="renew-go">اعمال</button><button class="btn btn-ghost" data-close>انصراف</button>`,
    });
    const back = modal._last;
    const upd = () => { back.querySelector('#rcost').textContent = money((parseInt(back.querySelector('#add-gb').value, 10) || 0) * price); };
    back.querySelector('#add-gb').oninput = upd;
    back.querySelector('#renew-go').onclick = async () => {
      const addGb = parseInt(back.querySelector('#add-gb').value, 10) || 0;
      const planId = back.querySelector('#renew-plan').value ? parseInt(back.querySelector('#renew-plan').value, 10) : null;
      if (!addGb && !planId) return toast('پلن یا حجم را انتخاب کنید', 'err');
      try {
        await api('POST', `/api/users/${id}/renew`, { addGb, planId });
        try { const me = await api('GET', '/api/me'); ME = me.identity; refreshBalanceBadge(); } catch (e) {}
        toast('انجام شد', 'ok'); back._close(true); go('users');
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  // ---------- Transactions ----------
  async function viewTx(c) {
    const rows = await api('GET', '/api/transactions');
    const ttype = { topup: 'افزایش', deduct: 'کاهش', charge: 'خرید', refund: 'بازگشت', initial: 'اولیه', adjust: 'تنظیم' };
    c.innerHTML = `<div class="card">
      <div class="card-h">${ICON.coin}<h3>تراکنش‌ها</h3></div>
      <div class="tbl-wrap">${
        !rows.length ? `<div class="empty">تراکنشی نیست</div>` :
        `<table><thead><tr><th>زمان</th><th>نوع</th><th>مبلغ</th><th>مانده</th><th>توضیح</th></tr></thead><tbody>
        ${rows.map((t) => `<tr>
          <td class="nowrap muted">${fmtDT(t.created_at)}</td>
          <td><span class="badge ${t.amount >= 0 ? 'on' : 'off'}">${ttype[t.type] || t.type}</span></td>
          <td class="nowrap" style="color:${t.amount >= 0 ? '#34d399' : '#fb7185'}">${t.amount >= 0 ? '+' : ''}${money(t.amount)}</td>
          <td class="nowrap">${money(t.balance_after)}</td>
          <td class="muted">${esc(t.note || '')}</td>
        </tr>`).join('')}</tbody></table>`
      }</div></div>`;
  }
  function fmtDT(ms) { try { return new Date(Number(ms)).toLocaleString('fa-IR'); } catch (e) { return ''; } }

  boot();
})();
