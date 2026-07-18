const app = document.querySelector("#admin-app");
let state = { admin: null, configured: true, data: null, selectedUserId: null, error: "" };

boot();

async function boot() {
  try {
    const data = await api("/api/admin/me");
    state.admin = data.admin;
    state.configured = data.configured;
    if (state.admin) await loadOverview();
  } catch (_error) {
    state.admin = null;
  }
  render();
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "request_failed");
  return data;
}

async function loadOverview() {
  state.data = await api("/api/admin/overview");
}

function render() {
  if (!state.configured) return renderSetup();
  if (!state.admin) return renderLogin();
  renderDashboard();
}

function renderSetup() {
  app.innerHTML = `
    <section class="admin-login">
      <form class="login-card login-form" data-admin-setup>
        <div class="brand auth-brand"><strong>FAIR<span>PAY</span></strong></div>
        <img class="admin-login-logo" src="/APP-icon.png?v=157" alt="" />
        <div class="admin-login-copy">
          <h1>הקמת אדמין</h1>
          <p>זו הכניסה הראשונה. בחר שם אדמין וסיסמה לניהול FAIRPAY.</p>
        </div>
        ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
        <label>שם אדמין<input name="username" autocomplete="username" required /></label>
        <label>סיסמה<input name="password" type="password" autocomplete="new-password" required /></label>
        <button class="primary-button" type="submit"><i class="bi bi-shield-lock"></i><span>יצירת אדמין</span></button>
        <a class="admin-back-link" href="/">חזרה לכניסה רגילה</a>
      </form>
    </section>
  `;
  document.querySelector("[data-admin-setup]").addEventListener("submit", setupAdmin);
}

function renderLogin() {
  app.innerHTML = `
    <section class="admin-login">
      <form class="login-card login-form" data-admin-login>
        <div class="brand auth-brand"><strong>FAIR<span>PAY</span></strong></div>
        <img class="admin-login-logo" src="/APP-icon.png?v=157" alt="" />
        <div class="admin-login-copy">
          <h1>כניסת אדמין</h1>
          <p>ניהול משתמשים, הזמנות, גיבוי וסטטוס מערכת.</p>
        </div>
        ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
        <label>שם משתמש<input name="username" autocomplete="username" required /></label>
        <label>סיסמה<input name="password" type="password" autocomplete="current-password" required /></label>
        <button class="primary-button" type="submit"><i class="bi bi-box-arrow-in-left"></i><span>כניסה</span></button>
        <a class="admin-back-link" href="/">חזרה לכניסה רגילה</a>
      </form>
    </section>
  `;
  document.querySelector("[data-admin-login]").addEventListener("submit", login);
}

function renderDashboard() {
  const { stats, users, invites, activity } = state.data;
  app.innerHTML = `
    <section class="admin-shell">
      <header class="admin-header">
        <div>
          <h1>אזור אדמין</h1>
          <p>מחובר כ-${escapeHtml(state.admin.username)}</p>
        </div>
        <div class="admin-actions">
          <a class="soft-button" href="/api/admin/backup"><i class="bi bi-download"></i><span>הורדת גיבוי</span></a>
          <button class="soft-button" type="button" data-refresh><i class="bi bi-arrow-clockwise"></i><span>רענון</span></button>
          <button class="soft-button" type="button" data-logout><i class="bi bi-box-arrow-right"></i><span>יציאה</span></button>
        </div>
      </header>

      <div class="stats-grid">
        ${statCard("משתמשים", stats.users)}
        ${statCard("הזמנות פעילות", stats.activeInvites)}
        ${statCard("הוצאות", stats.expenses)}
        ${statCard("מסעדות פתוחות", stats.openRestaurants)}
        ${statCard("גודל DB", formatBytes(stats.dbSize))}
      </div>

      <div class="admin-grid">
        <section class="admin-card">
          <h2>משתמשים</h2>
          <div class="users-list">${users.length ? users.map(userRow).join("") : `<p class="empty">אין משתמשים עדיין.</p>`}</div>
        </section>

        <div class="side-list">
          <section class="admin-card">
            <h2>קישורי הזמנה פעילים</h2>
            <div class="side-list">${invites.length ? invites.map(inviteRow).join("") : `<p class="empty">אין הזמנות פעילות.</p>`}</div>
          </section>
          <section class="admin-card">
            <h2>פעילות אחרונה</h2>
            <div class="side-list">${activity.length ? activity.map(activityRow).join("") : `<p class="empty">אין פעילות להצגה.</p>`}</div>
          </section>
        </div>
      </div>
    </section>
    ${selectedUserModal(users)}
  `;
  document.querySelector("[data-refresh]").addEventListener("click", refresh);
  document.querySelector("[data-logout]").addEventListener("click", logout);
  document.querySelectorAll("[data-user-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedUserId = Number(button.dataset.userId);
      render();
    });
  });
  document.querySelectorAll("[data-close-user-modal]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedUserId = null;
      render();
    });
  });
  document.querySelectorAll("[data-revoke]").forEach((button) => {
    button.addEventListener("click", () => revokeInvite(button.dataset.revoke));
  });
}

function statCard(label, value) {
  return `<div class="stat-card"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function userRow(user) {
  return `
    <button class="user-row" type="button" data-user-id="${user.id}">
      ${avatar(user)}
      <div class="user-main">
        <strong>${escapeHtml(user.name)}</strong>
        <span>${escapeHtml(user.email)}</span>
      </div>
      <span class="user-row-chevron"><i class="bi bi-chevron-left"></i></span>
    </button>
  `;
}

function selectedUserModal(users) {
  const user = users.find((item) => Number(item.id) === Number(state.selectedUserId));
  if (!user) return "";
  return `
    <div class="admin-modal-backdrop" data-close-user-modal>
      <section class="admin-user-modal" role="dialog" aria-modal="true" aria-label="פרטי משתמש" onclick="event.stopPropagation()">
        <button class="modal-close" type="button" data-close-user-modal aria-label="סגירה"><i class="bi bi-x-lg"></i></button>
        <div class="modal-user-head">
          ${avatar(user)}
          <div>
            <h2>${escapeHtml(user.name)}</h2>
            <span>משתמש #${escapeHtml(user.id)}</span>
          </div>
        </div>
        <dl class="user-detail-list">
          ${detailRow("אימייל", user.email)}
          ${detailRow("טלפון", user.phone || "אין טלפון")}
          ${detailRow("תאריך לידה", user.birthDate || "-")}
          ${detailRow("נוצר", formatDate(user.createdAt))}
        </dl>
        <div class="modal-metrics">
          ${modalMetric("קבוצות", user.groupCount)}
          ${modalMetric("הוצאות", user.expenseCount)}
        </div>
      </section>
    </div>
  `;
}

function detailRow(label, value) {
  return `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function modalMetric(label, value) {
  return `<div><strong>${escapeHtml(value)}</strong><span>${label}</span></div>`;
}

function inviteRow(invite) {
  return `
    <article class="side-row">
      <div>
        <strong>${escapeHtml(invite.eventName)}</strong>
        <span>נוצר על ידי ${escapeHtml(invite.createdByName)} · פג ${escapeHtml(formatDate(invite.expiresAt))}</span>
      </div>
      <button class="danger-button" type="button" data-revoke="${escapeHtml(invite.token)}"><i class="bi bi-x-lg"></i><span>בטל</span></button>
    </article>
  `;
}

function activityRow(item) {
  const labels = {
    user_registered: "משתמש חדש",
    expense_created: "הוצאה נוספה",
    invite_created: "קישור הזמנה",
    debt_closed: "חוב נסגר"
  };
  const icons = {
    user_registered: "bi-person-plus",
    expense_created: "bi-receipt",
    invite_created: "bi-link-45deg",
    debt_closed: "bi-check2-circle"
  };
  return `
    <article class="side-row activity-row">
      <span class="activity-icon"><i class="bi ${icons[item.type] || "bi-clock"}"></i></span>
      <div>
        <strong>${labels[item.type] || "פעילות"}</strong>
        <span>${escapeHtml(item.title || "")} · ${escapeHtml(item.detail || "")}</span>
        <span>${escapeHtml(formatDate(item.createdAt))}</span>
      </div>
    </article>
  `;
}

function avatar(user) {
  if (user.avatarUrl) return `<span class="avatar"><img src="${escapeHtml(user.avatarUrl)}" alt="" /></span>`;
  return `<span class="avatar">${escapeHtml(initials(user.name))}</span>`;
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    state.error = "";
    const data = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") })
    });
    state.admin = data.admin;
    await loadOverview();
    render();
  } catch (error) {
    state.error = error.message === "invalid_admin_credentials" ? "שם המשתמש או הסיסמה לא נכונים." : "לא הצלחנו להתחבר.";
    render();
  }
}

async function setupAdmin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    state.error = "";
    const data = await api("/api/admin/setup", {
      method: "POST",
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") })
    });
    state.admin = data.admin;
    state.configured = true;
    await loadOverview();
    render();
  } catch (error) {
    state.error = error.message === "admin_already_configured" ? "כבר הוגדר אדמין למערכת." : "לא הצלחנו ליצור אדמין.";
    render();
  }
}

async function refresh() {
  await loadOverview();
  render();
}

async function logout() {
  await api("/api/admin/logout", { method: "POST", body: "{}" });
  state.admin = null;
  state.data = null;
  render();
}

async function revokeInvite(token) {
  const data = await api(`/api/admin/invites/${encodeURIComponent(token)}/revoke`, { method: "POST", body: "{}" });
  state.data.invites = data.invites;
  state.data.activity = data.activity;
  render();
}

function initials(name) {
  return String(name || "אד")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
