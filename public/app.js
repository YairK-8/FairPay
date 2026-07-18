const state = {
  user: null,
  events: [],
  activeEventId: null,
  eventData: null,
  activeRestaurantBillId: null,
  activeExpenseId: null,
  activeSettlementFlow: null,
  profileAvatarDraft: null,
  eventAvatarDraft: null,
  currencyOutsideBound: false,
  authMode: "login",
  authError: "",
  drawer: null,
  inviteToken: location.pathname.startsWith("/invite/") ? location.pathname.split("/").pop() : null,
  inviteInfo: null,
  message: "",
  toast: ""
};

const app = document.querySelector("#app");
const fmt = new Intl.NumberFormat("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let toastTimer;

const motion = {
  reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  render(options = {}) {
    render(options);
  },
  async page(direction, updateView) {
    if (this.reduced) {
      updateView();
      return;
    }
    if (!document.startViewTransition) {
      updateView();
      this.pageFallback(direction);
      return;
    }
    document.documentElement.dataset.pageTransition = direction;
    const transition = document.startViewTransition(updateView);
    try {
      await transition.finished;
    } finally {
      delete document.documentElement.dataset.pageTransition;
    }
  },
  pageFallback(direction) {
    const main = document.querySelector(".mobile-main");
    if (!main) return;
    const fromX = direction === "back" ? "-18%" : "22%";
    main.animate(
        [
          { opacity: 0, transform: `translate3d(${fromX}, 0, 0)` },
          { opacity: 1, transform: "translate3d(0, 0, 0)" }
      ],
      {
        duration: 430,
        easing: "cubic-bezier(.16, 1, .3, 1)",
        fill: "both"
      }
    );
  },
  afterRender(options = {}) {
    if (options.cards && !this.reduced) this.cardsEnter(app);
    if (options.drawer) this.sheetOpen();
  },
  cardsEnter(root) {
    const cards = root.querySelectorAll(
      ".profile-card, .groups-section .group-row, .event-wallet-card, .event-section, .restaurant-bill-row, .expense-mobile-row, .balance-mobile-row, .home-create-bar, .event-bottom-actions"
    );
    cards.forEach((card, index) => {
      card.animate(
        [
          { opacity: 0, transform: "translate3d(0, 28px, 0)" },
          { opacity: 1, transform: "translate3d(0, 0, 0)" }
        ],
        {
          duration: 460,
          delay: Math.min(index * 55, 320),
          easing: "cubic-bezier(.16, 1, .3, 1)",
          fill: "both"
        }
      );
    });
  },
  sheetOpen() {
    const backdrop = document.querySelector(".drawer-backdrop");
    const sheet = document.querySelector(".expense-modal");
    if (!sheet) return;
    backdrop?.classList.remove("is-closing");
    sheet.classList.remove("is-closing");
    sheet.getBoundingClientRect();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        backdrop?.classList.add("is-open");
        sheet.classList.add("is-open");
      });
    });
  },
  async sheetClose() {
    const backdrop = document.querySelector(".drawer-backdrop");
    const sheet = document.querySelector(".expense-modal");
    if (!sheet) return;
    backdrop?.classList.remove("is-open");
    sheet.classList.remove("is-open");
    sheet.classList.add("is-closing");
    if (!this.reduced) await waitForAnimation(sheet, 430);
    sheet.classList.remove("is-closing");
  },
  async cardRemove(element, removeCallback) {
    if (!element || this.reduced) {
      await removeCallback();
      return;
    }
    await element
      .animate(
        [
          { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0)" },
          { opacity: 0, transform: "translateY(36px) scale(.94)", filter: "blur(5px)" }
        ],
        { duration: 330, easing: "cubic-bezier(.7, 0, .84, 0)", fill: "forwards" }
      )
      .finished.catch(() => {});
    await removeCallback();
  }
};

boot();
registerServiceWorker();
startLiveRefresh();

async function boot() {
  try {
    if (state.inviteToken) await loadInviteInfo();
    const me = await api("/api/me");
    state.user = me.user;
    if (state.user) {
      await loadEvents();
      if (state.inviteToken) await joinInvite();
    }
  } catch (error) {
    state.message = "אין חיבור לשרת כרגע. אפשר לפתוח את האפליקציה, אבל הנתונים דורשים חיבור.";
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

function render(options = {}) {
  if (!state.user) return renderAuth();
  app.innerHTML = `
    <div class="mobile-shell">
      <main class="mobile-main ${state.eventData ? "event-main" : "home-main"}">${state.eventData ? eventView() : eventsView()}</main>
      ${
        state.eventData
          ? ""
          : `<button class="home-create-bar" type="button" data-action="new-event">${iconSvg("plus")}<span>יצירת קבוצה חדשה</span></button>`
      }
    </div>
    ${state.toast ? `<div class="app-toast" role="status">${escapeHtml(state.toast)}</div>` : ""}
    ${state.drawer ? drawerView() : ""}
  `;
  bind();
  motion.afterRender(options);
}

function startLiveRefresh() {
  setInterval(async () => {
    if (!state.user || state.drawer) return;
    try {
      if (state.activeEventId && state.eventData) {
        state.eventData = await api(`/api/events/${state.activeEventId}`);
      } else {
        await loadEvents();
      }
      render();
    } catch (_error) {
      // Keep the current view if a background refresh fails.
    }
  }, 4000);
}

function renderAuth() {
  const isRegister = state.authMode === "register";
  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-shell">
        <header class="auth-top">
          <strong class="fairpay-logo"><span>FAIR</span><span>PAY</span></strong>
        </header>
        <div class="auth-layout">
          <section class="auth-card">
            <img class="auth-watermark" src="/APP-icon.png?v=154" alt="" aria-hidden="true" />
            <div class="auth-hero-icon" aria-hidden="true"><img src="/APP-icon.png?v=154" alt="" /></div>
            <div class="auth-title">
              <h2>${isRegister ? "צור חשבון חדש" : "ברוכים הבאים!"}</h2>
              <p>${isRegister ? "הצטרפו ל-FAIRPAY והתחילו לנהל הוצאות משותפות." : "התחברו לחשבון FAIRPAY שלכם."}</p>
            </div>
            ${state.inviteToken ? `<p class="notice">קישור הצטרפות לקבוצה${state.inviteInfo?.eventName ? `: ${escapeHtml(state.inviteInfo.eventName)}` : ""}. התחבר או הירשם כדי להצטרף.</p>` : ""}
            ${state.authError ? `<p class="form-error">${escapeHtml(state.authError)}</p>` : ""}
            <form class="auth-form" data-form="auth">
              ${
                isRegister
                  ? `
                    ${authField("firstName", "שם פרטי", "הכנס שם פרטי", "user", "text", "given-name")}
                    ${authField("lastName", "שם משפחה", "הכנס שם משפחה", "users", "text", "family-name")}
                    ${authField("birthDate", "תאריך לידה", "תאריך לידה", "calendar", "date", "bday")}
                    ${authField("phone", "טלפון נייד", "050-1234567", "phone", "tel", "tel")}
                  `
                  : ""
              }
              ${authField("email", "אימייל", "you@example.com", "mail", "email", "email")}
              ${authField("password", "סיסמה", "הכנס סיסמה", "lock", "password", isRegister ? "new-password" : "current-password")}
              ${isRegister ? authField("confirmPassword", "אימות סיסמה", "הכנס שוב את הסיסמה", "lock", "password", "new-password") : ""}
              <button class="auth-submit" type="submit"><span>${isRegister ? "צור חשבון" : "כניסה"}</span>${iconSvg("arrow")}</button>
              ${isRegister ? "" : `<a class="auth-admin-text" href="/admin">כניסה כאדמין</a>`}
            </form>
            <div class="auth-divider"><span>או</span></div>
            <div class="auth-bottom">
              <button class="auth-secondary" type="button" data-action="toggle-auth">
                ${iconSvg(isRegister ? "arrow" : "userPlus")}
                <span>${isRegister ? "חזרה לכניסה" : "הצטרפות חדשה"}</span>
              </button>
            </div>
          </section>
        </div>
      </section>
    </main>
  `;
  bind();
}

function eventsView() {
  const total = state.events.reduce((sum, event) => sum + Number(event.totalExpenses || 0), 0);
  const owedToMe = state.events.filter((event) => event.userBalance > 0).reduce((sum, event) => sum + Number(event.userBalance || 0), 0);
  const iOwe = Math.abs(state.events.filter((event) => event.userBalance < 0).reduce((sum, event) => sum + Number(event.userBalance || 0), 0));
  return `
    <section class="profile-card">
      <div class="hero-watermark" aria-hidden="true">${iconSvg("sync")}</div>
      <div class="home-logo"><span>FAIR</span><span>PAY</span></div>
      <button class="profile-quick-logout" type="button" data-action="logout" aria-label="יציאה מהמשתמש">${iconSvg("close")}</button>
      <div class="profile-top">
        <button class="profile-avatar-button" type="button" data-action="profile" aria-label="פרטים אישיים">
          ${avatarMarkup(state.user, "large")}
        </button>
        <div class="profile-info">
          <h1>${escapeHtml(state.user.name)}</h1>
        </div>
      </div>
      <div class="balance-card">
        <div class="balance-grid">
          <div><span>אני חייב</span><strong class="red">${formatMoney(iOwe, "₪")}</strong></div>
          <div class="balance-total"><small>מאזן כללי</small><strong>${formatMoney(owedToMe - iOwe, "₪")}</strong></div>
          <div><span>חייבים לי</span><strong class="green">${formatMoney(owedToMe, "₪")}</strong></div>
        </div>
        <span class="balance-analytics" aria-hidden="true">${iconSvg("chart")}</span>
      </div>
    </section>
    <section class="groups-section">
      <div class="section-row">
        <h2>הקבוצות שלי</h2>
        <button type="button">${iconSvg("users")}<span>צפה בכל הקבוצות</span></button>
      </div>
      ${
        state.events.length
          ? `<div class="event-list">${state.events
              .map((event, index) => groupCard(event, index))
              .join("")}</div>`
          : `<div class="home-empty"><strong>אין עדיין קבוצות</strong><span>לחץ על הפלוס הירוק כדי ליצור קבוצה ראשונה.</span></div>`
      }
    </section>
  `;
}

function groupCard(event, index) {
  const isPositive = Number(event.userBalance || 0) >= 0;
  const thumbClass = `group-thumb thumb-${index % 4}`;
  const canDelete = false;
  return `
    <button class="group-row" data-event-id="${event.id}">
      ${eventVisual(event, thumbClass)}
      <span class="group-main">
        <strong>${escapeHtml(event.name)}</strong>
        <small>${event.member_count} חברים</small>
        ${groupMembersPreview(event)}
      </span>
      <span class="group-balance">
        <small>${isPositive ? "חייבים לי" : "אני חייב"}</small>
        <b class="${isPositive ? "green" : "red"}">${formatMoney(Math.abs(Number(event.userBalance || 0)), "₪")}</b>
      </span>
      ${
        canDelete
          ? `<span class="group-delete" data-delete-event="${event.id}" title="מחיקת קבוצה" aria-label="מחיקת קבוצה">${iconSvg("trash")}</span>`
          : ""
      }
    </button>
  `;
}

function groupMembersPreview(event) {
  const members = Array.isArray(event.members) ? event.members.slice(0, 4) : [];
  const extra = Math.max(0, Number(event.member_count || 0) - members.length);
  if (!members.length) return `<span class="mini-members"><em>${Math.max(1, Number(event.member_count || 0))}</em></span>`;
  return `
    <span class="mini-members">
      ${members
        .map((member) =>
          member.avatarUrl
            ? `<i title="${escapeHtml(member.name)}"><img src="${escapeHtml(member.avatarUrl)}" alt="${escapeHtml(member.name)}" /></i>`
            : `<i title="${escapeHtml(member.name)}">${escapeHtml(initials(member.name))}</i>`
        )
        .join("")}
      ${extra > 0 ? `<em>+${extra}</em>` : ""}
    </span>
  `;
}

function eventView() {
  const { event, members, expenses, settlement } = state.eventData;
  const isOwner = Number(event.owner_id) === Number(state.user.id);
  const myBalance = settlement.balances.find((balance) => balance.userId === state.user.id);
  const myAmount = Number(myBalance?.balance || 0);
  const owedToMe = Math.max(myAmount, 0);
  const iOwe = Math.abs(Math.min(myAmount, 0));
  return `
    ${eventHeroBackground(event)}
    <header class="event-screen-header">
      <div>
        <h1>${escapeHtml(event.name)}</h1>
        <p>${members.length} חברים · החזר ב-${escapeHtml(event.base_currency)} · הוצאות ב-${escapeHtml(event.spending_currency || event.base_currency)}</p>
      </div>
    </header>
    ${state.message ? `<p class="notice event-notice">${escapeHtml(state.message)}</p>` : ""}
    <section class="event-wallet-card">
      <div class="event-wallet-title">${iconSvg("wallet")}<span>החשבון שלי</span></div>
      <div class="event-wallet-grid">
        <div>
          <span>אני חייב</span>
          <strong class="red">${formatMoney(iOwe, event.base_currency)}</strong>
        </div>
        <div>
          <span>מאזן כללי</span>
          <strong>${formatMoney(myAmount, event.base_currency)}</strong>
        </div>
        <div>
          <span>חייבים לי</span>
          <strong class="green">${formatMoney(owedToMe, event.base_currency)}</strong>
        </div>
      </div>
      <div class="event-wallet-total">
        <div>
          <small>סה"כ הוצאות</small>
          <strong>${formatMoney(settlement.totalExpenses, event.base_currency)}</strong>
        </div>
      </div>
    </section>
    ${openRestaurantBillsView(state.eventData.restaurantBills || [], members)}
    <section class="event-section">
      <div class="event-section-title">
        <h2>מי חייב למי</h2>
        <span>${settlement.flows.length} העברות</span>
      </div>
      ${mobileFlowsView(settlement.flows, event.base_currency)}
    </section>
    <section class="event-section">
      <div class="event-section-title">
        <h2>יתרות בקבוצה</h2>
        <span>${members.length} חברים</span>
      </div>
      ${mobileBalancesView(settlement.balances, event.base_currency)}
    </section>
    <section class="event-section">
      <div class="event-section-title">
        <h2>הוצאות</h2>
        <span>${expenses.length} פריטים</span>
      </div>
      ${mobileExpensesView(expenses, members, event.base_currency)}
    </section>
    <div class="event-bottom-actions ${isOwner ? "owner-actions" : "member-actions"}">
      <button class="event-bottom-action event-icon-action" type="button" data-action="back-events" aria-label="חזרה לבית">${iconSvg("home")}<span>בית</span></button>
      ${isOwner ? `<button class="event-bottom-action event-icon-action" type="button" data-action="edit-event" aria-label="עריכת קבוצה">${iconSvg("edit")}<span>עריכה</span></button>` : ""}
      <button class="event-bottom-action event-add-expense-button" type="button" data-action="new-expense">${iconSvg("plus")}<span>הוצאה</span></button>
      ${isOwner ? `<button class="event-bottom-action event-icon-action" type="button" data-action="invite" aria-label="קישור הזמנה">${iconSvg("share")}<span>הזמן</span></button>` : ""}
      <button class="event-bottom-action restaurant-action" type="button" data-action="new-restaurant-expense">${iconSvg("restaurant")}<span>מסעדה</span></button>
    </div>
  `;
}

function mobileFlowsView(flows, currency) {
  if (!flows.length) return `<div class="home-empty"><strong>הכול מאוזן</strong><span>אין כרגע חובות פתוחים בקבוצה הזאת.</span></div>`;
  return `<div class="settlement-mobile-list">${flows
    .map(
      (flow) => {
        const canClose = Number(flow.toUserId) === Number(state.user?.id);
        return `
        <button class="settlement-mobile-row${canClose ? "" : " settlement-mobile-row-readonly"}" type="button" ${canClose ? `data-settlement-flow="${escapeHtml(`${flow.fromUserId}:${flow.toUserId}:${flow.amount}`)}"` : "disabled"}>
          <div class="settlement-person settlement-to">
            <small>מקבל</small>
            <strong>${escapeHtml(flow.toName)}</strong>
          </div>
          <div class="settlement-arrow-box" aria-hidden="true">${iconSvg("settlementArrow")}</div>
          <div class="settlement-person settlement-from">
            <small>משלם</small>
            <strong>${escapeHtml(flow.fromName)}</strong>
          </div>
          <div class="settlement-amount">
            <small>${canClose ? "סכום להעברה" : "רק המקבל יכול לסגור"}</small>
            <b>${formatMoney(flow.amount, currency)}</b>
          </div>
        </button>`;
      }
    )
    .join("")}</div>`;
}

function mobileBalancesView(balances, currency) {
  return `<div class="balance-mobile-list">${balances
    .map(
      (balance) => `
        <div class="balance-mobile-row">
          ${memberAvatarMarkup(balance)}
          <div>
            <strong>${escapeHtml(balance.name)}</strong>
            <small>${balance.balanceCents >= 0 ? "צריך לקבל" : "צריך לשלם"}</small>
          </div>
          <b class="${balance.balanceCents >= 0 ? "green" : "red"}">${formatMoney(Math.abs(balance.balance), currency)}</b>
        </div>`
    )
    .join("")}</div>`;
}

function openRestaurantBillsView(bills, members) {
  if (!bills.length) return "";
  return `
    <section class="event-section">
      <div class="event-section-title">
        <h2>מסעדות פתוחות</h2>
        <span>${bills.length} ממתינות</span>
      </div>
      <div class="restaurant-bill-list">
        ${bills
          .map((bill) => {
            const myItem = bill.items.find((item) => item.userId === state.user.id);
            const filledCount = bill.items.filter((item) => item.amountCents > 0).length;
            const canDelete = bill.totalCents === 0 && !bill.items.some((item) => item.amountCents > 0);
            return `
              <button class="restaurant-bill-row" type="button" data-restaurant-bill-id="${bill.id}" data-restaurant-empty="${canDelete ? "true" : "false"}">
                <span class="expense-icon expense-icon-restaurant">${iconSvg("restaurant")}</span>
                <span class="restaurant-bill-main">
                  <strong>${escapeHtml(bill.title)}</strong>
                  <small>${filledCount}/${members.length} מילאו · החלק שלי ${formatMoney(myItem?.amount || 0, myItem?.currency || bill.currency)}</small>
                </span>
                <span class="restaurant-bill-total">
                  <small>סה"כ</small>
                  <b>${bill.hasMixedCurrencies ? "מטבעות שונים" : formatMoney(bill.total, bill.currency)}</b>
                </span>
                ${
                  canDelete
                    ? `<span class="restaurant-bill-delete" data-delete-restaurant-bill="${bill.id}" aria-label="מחיקת מסעדה">${iconSvg("close")}</span>`
                    : ""
                }
              </button>`;
          })
          .join("")}
      </div>
    </section>`;
}

function mobileExpensesView(expenses, members, baseCurrency) {
  if (!expenses.length) return `<div class="home-empty"><strong>אין עדיין הוצאות</strong><span>הוסף הוצאה ראשונה כדי לראות את החישוב מתעדכן.</span></div>`;
  return `<div class="expense-mobile-list">${expenses
    .map((expense) => {
      const payer = members.find((member) => member.id === expense.payers[0]?.userId);
      const converted = (expense.amountCents * expense.exchangeRate) / 100;
      const category = categoryMeta(expense.category);
      return `
        <div class="expense-mobile-row" data-expense-id="${expense.id}">
          <span class="expense-icon expense-icon-${escapeHtml(category.value)}">${category.icon}</span>
          <div class="expense-main">
            <strong>${escapeHtml(expense.title)}</strong>
            <small>${escapeHtml(category.label)} · ${escapeHtml(payer?.name || "כמה משלמים")} · ${escapeHtml(expense.expenseDate)}</small>
          </div>
          <div class="expense-amount">
            <b>${formatMoney(converted, baseCurrency)}</b>
            <small>${expense.currency === baseCurrency ? "" : `${fmt.format(expense.amount)} ${escapeHtml(expense.currency)}`}</small>
          </div>
          <button class="expense-delete" type="button" data-delete-expense="${expense.id}" aria-label="מחיקת הוצאה">${iconSvg("trash")}</button>
        </div>`;
    })
    .join("")}</div>`;
}

function balancesTable(balances, currency) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>משתתף</th><th>יתרה</th></tr></thead>
        <tbody>
          ${balances
            .map(
              (balance) => `
                <tr>
                  <td>${escapeHtml(balance.name)}</td>
                  <td class="${balance.balanceCents >= 0 ? "positive" : "negative"}">${formatMoney(balance.balance, currency)}</td>
                </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function flowsView(flows, currency) {
  if (!flows.length) return `<div class="empty">הכול מאוזן. אין חובות פתוחים כרגע.</div>`;
  return `<div class="flow-list">${flows
    .map(
      (flow) => `
        <div class="flow">
          <strong>${escapeHtml(flow.fromName)}</strong>
          <span class="flow-arrow">←</span>
          <strong>${escapeHtml(flow.toName)}</strong>
          <span class="amount">${formatMoney(flow.amount, currency)}</span>
        </div>`
    )
    .join("")}</div>`;
}

function expensesTable(expenses, members, baseCurrency) {
  if (!expenses.length) return `<div class="empty">אין עדיין הוצאות. הוסף הוצאה כדי לראות חישוב יתרות.</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>תאריך</th><th>שם ההוצאה</th><th>קטגוריה</th><th>שולם על ידי</th><th>מטבע</th><th>סכום</th><th>שווי ב־${escapeHtml(baseCurrency)}</th><th></th></tr></thead>
        <tbody>
          ${expenses
            .map((expense) => {
              const payer = members.find((member) => member.id === expense.payers[0]?.userId);
              return `
                <tr>
                  <td>${escapeHtml(expense.expenseDate)}</td>
                  <td>${escapeHtml(expense.title)}</td>
                  <td>${escapeHtml(categoryName(expense.category))}</td>
                  <td>${escapeHtml(payer?.name || "כמה משלמים")}</td>
                  <td>${escapeHtml(expense.currency)}</td>
                  <td>${fmt.format(expense.amount)}</td>
                  <td>${formatMoney((expense.amountCents * expense.exchangeRate) / 100, baseCurrency)}</td>
                  <td><button class="btn" data-delete-expense="${expense.id}">מחיקה</button></td>
                </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function drawerView() {
  if (state.drawer === "profile") return profileDrawerView();

  if (state.drawer === "event" || state.drawer === "event-edit") return eventDrawerView(state.drawer === "event-edit");

  const members = state.eventData?.members || [];
  const event = state.eventData?.event;
  const baseCurrency = event?.base_currency || "ILS";
  const spendingCurrency = event?.spending_currency || baseCurrency;
  if (state.drawer === "restaurant-setup") return restaurantSetupDrawerView(baseCurrency, spendingCurrency);
  if (state.drawer === "restaurant-bill") return restaurantBillDrawerView(members, baseCurrency);
  if (state.drawer === "expense-details") return expenseDetailsDrawerView(members, baseCurrency);
  if (state.drawer === "settlement-payment") return settlementPaymentDrawerView(baseCurrency);
  return `
    <div class="drawer-backdrop modal-backdrop">
      <aside class="expense-modal">
        <div class="expense-modal-handle"></div>
        <div class="expense-modal-header">
          <div>
            <span>הוצאה חדשה</span>
            <h2>מה שילמת?</h2>
          </div>
          <button class="round-action" type="button" data-action="close-drawer" aria-label="סגירה">${iconSvg("close")}</button>
        </div>
        <form class="expense-form" data-form="expense" data-base-currency="${escapeHtml(baseCurrency)}">
          <label class="expense-input wide">
            <span>שם ההוצאה</span>
            <input name="title" required placeholder="מונית לשדה, ארוחת ערב, מלון..." />
          </label>
          <section class="expense-card">
            <div class="expense-card-title">
              <h3>קטגוריה</h3>
              <small>בחר מה הכי מתאים</small>
            </div>
            <div class="category-grid">
              ${categoryOptions()
                .map(
                  (category, index) => `
                    <label class="category-chip">
                      <input type="radio" name="category" value="${category.value}" ${index === 0 ? "checked" : ""} />
                      <span>${category.icon}</span>
                      <b>${category.label}</b>
                    </label>`
                )
                .join("")}
            </div>
          </section>
          <div class="expense-two">
            <label class="expense-input">
              <span>תאריך</span>
              <input name="expenseDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required />
            </label>
            <label class="expense-input">
              <span>שולם על ידי</span>
              <select name="payer">${members.map((member) => `<option value="${member.id}" ${member.id === state.user.id ? "selected" : ""}>${escapeHtml(member.name)}</option>`).join("")}</select>
            </label>
          </div>
          <section class="expense-card">
            <div class="expense-card-title">
              <h3>סכום ומטבע</h3>
              <small>יומר אוטומטית ל־${escapeHtml(baseCurrency)}</small>
            </div>
            <div class="amount-currency-row">
              <label class="expense-input">
                <span>סכום ששולם</span>
                <input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required placeholder="0.00" />
              </label>
              <label class="expense-input">
                <span>מטבע</span>
                ${currencySearchInput("currency", spendingCurrency)}
              </label>
            </div>
            <div class="rate-panel">
              <div>
                <span>המרה אוטומטית</span>
                <strong data-rate-label>1 ${escapeHtml(baseCurrency)} = 1 ${escapeHtml(baseCurrency)}</strong>
              </div>
              <button type="button" data-rate-refresh>${iconSvg("sync")}<span>עדכן</span></button>
              <input name="exchangeRate" type="hidden" value="1" required />
            </div>
            <div class="converted-panel">
              <span>סכום במטבע הקבוצה</span>
              <strong data-converted>${formatMoney(0, baseCurrency)}</strong>
            </div>
          </section>
          <section class="expense-card">
            <div class="expense-card-title">
              <h3>משתתפים וחלוקה</h3>
              <small>כולא מסומנים אוטומטית</small>
            </div>
            <div class="split-switch" role="radiogroup" aria-label="סוג חלוקה">
              <label><input type="radio" name="splitType" value="equal" checked /><span>חלוקה שווה</span></label>
              <label><input type="radio" name="splitType" value="unequal" /><span>לא שווה</span></label>
            </div>
            <div class="participants-list">
              ${members
                .map(
                  (member) => `
                    <div class="participant-row">
                      <label class="participant-check">
                        <input type="checkbox" name="participant" value="${member.id}" checked />
                        ${participantAvatarMarkup(member)}
                        <b>${escapeHtml(member.name)}</b>
                      </label>
                      <label class="share-input">
                        <small>חלק</small>
                        <input name="share-${member.id}" type="number" step="0.01" min="0" value="0" disabled />
                      </label>
                    </div>`
                )
                .join("")}
            </div>
          </section>
          <button class="expense-save" type="submit">${iconSvg("check")}<span>שמור הוצאה</span></button>
        </form>
      </aside>
    </div>`;
}

function profileDrawerView() {
  const user = state.user || {};
  const avatar = state.profileAvatarDraft ?? user.avatarUrl ?? "";
  return `
    <div class="drawer-backdrop modal-backdrop">
      <aside class="expense-modal profile-modal">
        <div class="expense-modal-handle"></div>
        <div class="expense-modal-header">
          <div>
            <span>החשבון שלי</span>
            <h2>פרטים אישיים</h2>
          </div>
          <button class="round-action" type="button" data-action="close-drawer" aria-label="סגירה">${iconSvg("close")}</button>
        </div>
        <form class="expense-form" data-form="profile">
          <section class="expense-card profile-editor-card">
            <label class="profile-photo-picker">
              <input name="avatarFile" type="file" accept="image/*" />
              <span class="profile-photo-preview">${avatar ? `<img src="${escapeHtml(avatar)}" alt="" />` : initials(user.name)}</span>
              <b>החלף תמונה</b>
            </label>
            <input name="avatarUrl" type="hidden" value="${escapeHtml(avatar)}" />
          </section>
          <section class="expense-card">
            <div class="expense-card-title">
              <h3>פרטי משתמש</h3>
              <small>אפשר לעדכן בכל רגע</small>
            </div>
            <label class="expense-input">
              <span>שם מלא</span>
              <input name="name" required value="${escapeHtml(user.name || "")}" />
            </label>
            <label class="expense-input">
              <span>אימייל</span>
              <input name="email" type="email" required dir="ltr" value="${escapeHtml(user.email || "")}" />
            </label>
            <label class="expense-input">
              <span>טלפון נייד</span>
              <input name="phone" type="tel" dir="ltr" placeholder="050-1234567" value="${escapeHtml(user.phone || "")}" />
            </label>
            <label class="expense-input">
              <span>תאריך לידה</span>
              <input name="birthDate" type="text" placeholder="DD/MM/YYYY" value="${escapeHtml(user.birthDate || "")}" />
            </label>
          </section>
          <button class="expense-save" type="submit">${iconSvg("check")}<span>שמור פרטים</span></button>
          <button class="profile-logout" type="button" data-action="logout">${iconSvg("back")}<span>יציםה מהחשבון</span></button>
        </form>
      </aside>
    </div>`;
}

function expenseDetailsDrawerView(members, baseCurrency) {
  const expense = (state.eventData?.expenses || []).find((item) => String(item.id) === String(state.activeExpenseId));
  if (!expense) return "";
  const payerNames = expense.payers.map((payer) => members.find((member) => member.id === payer.userId)?.name || "משלם").join(", ");
  const category = categoryMeta(expense.category);
  const converted = (expense.amountCents * expense.exchangeRate) / 100;
  return `
    <div class="drawer-backdrop modal-backdrop">
      <aside class="expense-modal">
        <div class="expense-modal-handle"></div>
        <div class="expense-modal-header">
          <div>
            <span>${escapeHtml(category.label)}</span>
            <h2>${escapeHtml(expense.title)}</h2>
          </div>
          <button class="round-action" type="button" data-action="close-drawer" aria-label="סגירה">${iconSvg("close")}</button>
        </div>
        <section class="expense-card details-card">
          <div class="detail-row"><span>שולם על ידי</span><strong>${escapeHtml(payerNames)}</strong></div>
          <div class="detail-row"><span>סכום מקורי</span><strong>${formatMoney(expense.amount, expense.currency)}</strong></div>
          <div class="detail-row"><span>במטבע הקבוצה</span><strong>${formatMoney(converted, baseCurrency)}</strong></div>
          <div class="detail-row"><span>תאריך</span><strong>${escapeHtml(expense.expenseDate)}</strong></div>
          <div class="detail-row"><span>חלוקה</span><strong>${expense.splitType === "equal" ? "שווה" : "לא שווה"}</strong></div>
        </section>
        <section class="expense-card">
          <div class="expense-card-title"><h3>משתתפים</h3><small>${expense.participants.length} אנשים</small></div>
          <div class="restaurant-orders">
            ${expense.participants
              .map((participant) => {
                const member = members.find((item) => item.id === participant.userId);
                return `
                  <div class="restaurant-order-row readonly">
                    ${memberAvatarMarkup(member)}
                    <b>${escapeHtml(member?.name || "משתתף")}</b>
                    <strong>${expense.splitType === "equal" ? "חלק שווה" : formatMoney((participant.shareCents || 0) / 100, expense.currency)}</strong>
                  </div>`;
              })
              .join("")}
          </div>
        </section>
      </aside>
    </div>`;
}

function settlementPaymentDrawerView(baseCurrency) {
  const flow = state.activeSettlementFlow;
  if (!flow) return "";
  return `
    <div class="drawer-backdrop modal-backdrop">
      <aside class="expense-modal">
        <div class="expense-modal-handle"></div>
        <div class="expense-modal-header">
          <div>
            <span>סגירת חוב</span>
            <h2>${escapeHtml(flow.fromName)} משלם ל${escapeHtml(flow.toName)}</h2>
          </div>
          <button class="round-action" type="button" data-action="close-drawer" aria-label="סגירה">${iconSvg("close")}</button>
        </div>
        <form class="expense-form" data-form="settlement-payment">
          <section class="expense-card">
            <div class="expense-card-title">
              <h3>כמה שולם?</h3>
              <small>אפשר לסגור חלק מהחוב</small>
            </div>
            <label class="expense-input">
              <span>סכום</span>
              <input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" max="${flow.amount}" value="${flow.amount}" required />
            </label>
            <div class="converted-panel">
              <span>החוב המלא</span>
              <strong>${formatMoney(flow.amount, baseCurrency)}</strong>
            </div>
          </section>
          <button class="expense-save" type="submit">${iconSvg("check")}<span>סגור חוב</span></button>
        </form>
      </aside>
    </div>`;
}

function eventDrawerView(isEdit = false) {
  const event = isEdit ? state.eventData?.event : null;
  const title = isEdit ? "עריכת קבוצה" : "יצירת קבוצה";
  const subtitle = isEdit ? "עדכון פרטי הקבוצה" : "קבוצה חדשה";
  const name = event?.name || "";
  const baseCurrency = event?.base_currency || "ILS";
  const spendingCurrency = event?.spending_currency || "USD";
  const avatar = state.eventAvatarDraft || event?.avatar_url || "";
  const members = state.eventData?.members || [];
  const balances = state.eventData?.settlement?.balances || [];
  return `
    <div class="drawer-backdrop modal-backdrop">
      <aside class="expense-modal create-group-modal">
        <div class="expense-modal-handle"></div>
        <div class="expense-modal-header">
          <div>
            <span>${subtitle}</span>
            <h2>${title}</h2>
          </div>
          <button class="round-action" type="button" data-action="close-drawer" aria-label="סגירה">${iconSvg("close")}</button>
        </div>
        <form class="expense-form" data-form="event" data-mode="${isEdit ? "edit" : "create"}">
          <section class="expense-card">
            <div class="expense-card-title">
              <h3>פרטי הקבוצה</h3>
              <small>שם, תמונה ומטבעות ברירת מחדל</small>
            </div>
            <label class="profile-photo-picker group-photo-picker">
              <input name="eventAvatarFile" type="file" accept="image/*" />
              <span class="profile-photo-preview group-photo-preview">${avatar ? `<img src="${escapeHtml(avatar)}" alt="" />` : iconSvg("wallet")}</span>
              <b>${isEdit ? "החלף תמונת קבוצה" : "הוסף תמונה לקבוצה"}</b>
            </label>
            <label class="expense-input">
              <span>שם הקבוצה</span>
              <input name="name" required placeholder="טיול בגאורגיה" value="${escapeHtml(name)}" />
            </label>
            <label class="expense-input">
              <span>מטבע התחשבנות</span>
              <small>באיזה מטבע מחזירים כסף בסוף, למשל ILS</small>
              ${currencySearchInput("baseCurrency", baseCurrency)}
            </label>
            <label class="expense-input">
              <span>מטבע הוצאות ברירת מחדל</span>
              <small>באיזה מטבע רוב ההוצאות נרשמות, למשל USD</small>
              ${currencySearchInput("spendingCurrency", spendingCurrency)}
            </label>
          </section>
          ${isEdit ? eventMembersEditorView(members, balances, baseCurrency) : ""}
          <button class="expense-save" type="submit">${iconSvg(isEdit ? "edit" : "plus")}<span>${isEdit ? "שמירת שינויים" : "יצירת קבוצה"}</span></button>
          ${
            isEdit
              ? `<button class="event-delete-action" type="button" data-delete-event="${event.id}">${iconSvg("trash")}<span>מחיקת קבוצה</span></button>`
              : ""
          }
        </form>
      </aside>
    </div>`;
}

function eventMembersEditorView(members, balances, currency) {
  return `
    <section class="expense-card event-members-editor">
      <div class="expense-card-title">
        <h3>משתתפי הקבוצה</h3>
        <small>אפשר להסיר רק משתתף בלי חוב פתוח</small>
      </div>
      <div class="event-member-edit-list">
        ${members
          .map((member) => {
            const isOwner = Number(member.id) === Number(state.eventData?.event?.owner_id);
            const balance = balances.find((item) => Number(item.userId) === Number(member.id));
            const balanceCents = Number(balance?.balanceCents || 0);
            const canRemove = !isOwner && balanceCents === 0;
            return `
              <div class="event-member-edit-row">
                ${avatarMarkup(member, "mini")}
                <span class="event-member-edit-main">
                  <strong>${escapeHtml(member.name)}</strong>
                  <small>${isOwner ? "יוצר הקבוצה" : balanceCents === 0 ? "אין חוב פתוח" : `מאזן פתוח ${formatMoney(balance?.balance || 0, currency)}`}</small>
                </span>
                ${
                  canRemove
                    ? `<button class="member-remove-button" type="button" data-remove-member="${member.id}" aria-label="הסרת ${escapeHtml(member.name)}">${iconSvg("close")}</button>`
                    : `<span class="member-remove-lock">${isOwner ? iconSvg("lock") : formatMoney(balance?.balance || 0, currency)}</span>`
                }
              </div>`;
          })
          .join("")}
      </div>
    </section>`;
}

function inviteDrawerView() {
  const event = state.eventData?.event;
  return `
    <div class="drawer-backdrop modal-backdrop">
      <aside class="expense-modal invite-modal">
        <div class="expense-modal-handle"></div>
        <div class="expense-modal-header">
          <div>
            <span>${escapeHtml(event?.name || "קבוצה")}</span>
            <h2>קישור הזמנה</h2>
          </div>
          <button class="round-action" type="button" data-action="close-drawer" aria-label="סגירה">${iconSvg("close")}</button>
        </div>
        <form class="expense-form" data-form="invite">
          <section class="expense-card">
            <div class="expense-card-title">
              <h3>תוקף הקישור</h3>
              <small>קישור חדש מבטל את הקישור הקודא שנשלח לקבוצה הזאת</small>
            </div>
            <label class="expense-input">
              <span>הקישור יהיה פעיל למשך</span>
              <select name="expiresInHours">
                <option value="1">שעה אחת</option>
                <option value="24">יוא אחד</option>
                <option value="168" selected>7 ימים</option>
                <option value="720">30 ימים</option>
              </select>
            </label>
          </section>
          <button class="expense-save" type="submit">${iconSvg("share")}<span>יצירת קישור והעתקה</span></button>
        </form>
      </aside>
    </div>`;
}

function restaurantSetupDrawerView(baseCurrency, spendingCurrency = baseCurrency) {
  return `
    <div class="drawer-backdrop modal-backdrop">
      <aside class="expense-modal">
        <div class="expense-modal-handle"></div>
        <div class="expense-modal-header">
          <div>
            <span>מסעדה חדשה</span>
            <h2>הגדרת חשבון</h2>
          </div>
          <button class="round-action" type="button" data-action="close-drawer" aria-label="סגירה">${iconSvg("close")}</button>
        </div>
        <form class="expense-form restaurant-setup-form" data-form="restaurant-setup">
          <label class="expense-input wide">
            <span>שם המסעדה</span>
            <input name="title" required placeholder="למשל: ארוחת ערב, מסעדת החוף..." />
          </label>
          <section class="expense-card">
            <div class="expense-card-title">
              <h3>מטבע ברירת מחדל</h3>
              <small>כל אחד עדיין יוכל לבחור מטבע משלו</small>
            </div>
            <label class="expense-input">
              <span>מטבע המסעדה</span>
              ${currencySearchInput("currency", spendingCurrency)}
            </label>
          </section>
          <button class="expense-save" type="submit">${iconSvg("check")}<span>פתח מסעדה</span></button>
        </form>
      </aside>
    </div>`;
}

function restaurantBillDrawerView(members, baseCurrency) {
  const bill = (state.eventData?.restaurantBills || []).find((item) => String(item.id) === String(state.activeRestaurantBillId));
  if (!bill) return "";
  const myItem = bill.items.find((item) => item.userId === state.user.id);
  return `
    <div class="drawer-backdrop modal-backdrop">
      <aside class="expense-modal">
        <div class="expense-modal-handle"></div>
        <div class="expense-modal-header">
          <div>
            <span>מסעדה פתוחה</span>
            <h2>${escapeHtml(bill.title)}</h2>
          </div>
          <button class="round-action" type="button" data-action="close-drawer" aria-label="סגירה">${iconSvg("close")}</button>
        </div>
        <form class="expense-form restaurant-open-form" data-form="restaurant-item">
          <section class="expense-card">
            <div class="expense-card-title">
              <h3>החלק שלי</h3>
              <small>נשמר לחשבון הפתוח</small>
            </div>
            <div class="amount-currency-row restaurant-currency-row">
              <label class="expense-input">
                <span>כמה הזמנתי</span>
                <input name="amount" type="number" inputmode="decimal" step="0.01" min="0" value="${myItem?.amount || 0}" />
              </label>
              <label class="expense-input">
                <span>מטבע</span>
                ${currencySearchInput("currency", myItem?.currency || bill.currency || baseCurrency)}
              </label>
            </div>
          </section>
          <section class="expense-card">
            <div class="expense-card-title">
              <h3>מי מילא כמה</h3>
              <small>מתעדכן אצל כולא</small>
            </div>
            <div class="restaurant-orders">
              ${members
                .map((member) => {
                  const item = bill.items.find((row) => row.userId === member.id);
                  return `
                    <div class="restaurant-order-row readonly">
                      ${memberAvatarMarkup(member)}
                      <b>${escapeHtml(member.name)}</b>
                      <strong>${formatMoney(item?.amount || 0, item?.currency || bill.currency)}</strong>
                    </div>`;
                })
                .join("")}
            </div>
          </section>
          <button class="expense-save" type="submit">${iconSvg("check")}<span>שמור את החלק שלי</span></button>
        </form>
        <form class="expense-form restaurant-pay-form" data-form="restaurant-pay" data-base-currency="${escapeHtml(baseCurrency)}">
          <section class="expense-card">
            <div class="expense-card-title">
              <h3>סגירת חשבון</h3>
              <small>רק אחרי שמישהו שילא בפועל</small>
            </div>
            <div class="expense-two">
              <label class="expense-input">
                <span>מי שילא</span>
                <select name="payerId">${members.map((member) => `<option value="${member.id}" ${member.id === state.user.id ? "selected" : ""}>${escapeHtml(member.name)}</option>`).join("")}</select>
              </label>
              <label class="expense-input">
                <span>מטבע ששולם</span>
                ${currencySearchInput("currency", bill.currency || baseCurrency)}
              </label>
            </div>
            <div class="converted-panel">
              <span>סה"כ פתוח</span>
              <strong>${bill.hasMixedCurrencies ? "יחושב בסגירה" : formatMoney(bill.total, bill.currency)}</strong>
            </div>
          </section>
          <button class="expense-save restaurant-pay-button" type="submit">${iconSvg("wallet")}<span>שילמתי</span></button>
        </form>
      </aside>
    </div>`;
}

function bind() {
  document.querySelector('[data-form="auth"]')?.addEventListener("submit", submitAuth);
  const eventForm = document.querySelector('[data-form="event"]');
  eventForm?.addEventListener("submit", submitEvent);
  eventForm?.querySelector(".expense-save")?.addEventListener("click", async (event) => {
    event.preventDefault();
    await submitEvent({ preventDefault() {}, currentTarget: eventForm });
  });
  const expenseForm = document.querySelector('[data-form="expense"]');
  expenseForm?.addEventListener("submit", submitExpense);
  if (expenseForm) bindExpenseForm(expenseForm);
  document.querySelector('[data-form="restaurant-setup"]')?.addEventListener("submit", createRestaurantBill);
  document.querySelector('[data-form="restaurant-item"]')?.addEventListener("submit", submitRestaurantItem);
  document.querySelector('[data-form="restaurant-pay"]')?.addEventListener("submit", submitRestaurantPayment);
  document.querySelector('[data-form="settlement-payment"]')?.addEventListener("submit", submitSettlementPayment);
  document.querySelector('[data-form="profile"]')?.addEventListener("submit", submitProfile);
  document.querySelector('[name="avatarFile"]')?.addEventListener("change", handleAvatarFile);
  document.querySelector('[name="eventAvatarFile"]')?.addEventListener("change", handleEventAvatarFile);
  bindCurrencyPickers();

  document.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", async () => {
      const action = element.dataset.action;
      if (action === "toggle-auth") {
        state.authMode = state.authMode === "login" ? "register" : "login";
        state.authError = "";
      }
      if (action === "logout") await logout();
      if (action === "profile") {
        state.profileAvatarDraft = null;
        return openDrawer("profile");
      }
      if (action === "new-event") return openDrawer("event");
      if (action === "edit-event") {
        state.eventAvatarDraft = null;
        return openDrawer("event-edit");
      }
      if (action === "new-expense") return openDrawer("expense");
      if (action === "new-restaurant-expense") return openDrawer("restaurant-setup");
      if (action === "close-drawer") {
        return closeDrawer();
      }
      if (action === "back-events") {
        return motion.page("back", () => {
          state.eventData = null;
          state.activeEventId = null;
          render({ cards: true });
        });
      }
      if (action === "invite") await createInvite();
      render();
    });
  });

  document.querySelectorAll("[data-event-id]").forEach((element) => {
    element.addEventListener("click", () => openEvent(element.dataset.eventId));
  });

  document.querySelectorAll("[data-delete-event]").forEach((element) => {
    element.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await deleteEvent(element.dataset.deleteEvent);
    });
  });

  document.querySelectorAll("[data-remove-member]").forEach((element) => {
    element.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await removeEventMember(element.dataset.removeMember);
    });
  });

  document.querySelectorAll("[data-delete-expense]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteExpense(element.dataset.deleteExpense, element.closest(".expense-mobile-row"));
    });
  });

  document.querySelectorAll("[data-expense-id]").forEach((element) => {
    element.addEventListener("click", () => {
      state.activeExpenseId = element.dataset.expenseId;
      openDrawer("expense-details");
    });
  });

  document.querySelectorAll("[data-settlement-flow]").forEach((element) => {
    element.addEventListener("click", () => {
      const [fromUserId, toUserId, amount] = element.dataset.settlementFlow.split(":");
      const flow = state.eventData.settlement.flows.find((item) => String(item.fromUserId) === fromUserId && String(item.toUserId) === toUserId && String(item.amount) === amount);
      state.activeSettlementFlow = flow;
      openDrawer("settlement-payment");
    });
  });

  document.querySelectorAll("[data-restaurant-bill-id]").forEach((element) => {
    element.addEventListener("click", () => {
      state.activeRestaurantBillId = element.dataset.restaurantBillId;
      openDrawer("restaurant-bill");
    });
  });

  document.querySelectorAll("[data-delete-restaurant-bill]").forEach((element) => {
    element.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await deleteRestaurantBill(element.dataset.deleteRestaurantBill, element.closest(".restaurant-bill-row"));
    });
  });
}

function bindExpenseForm(form) {
  const refresh = () => updateExpenseForm(form);
  form.querySelector('[name="amount"]')?.addEventListener("input", () => {
    distributeUnequalShares(form);
    refresh();
  });
  form.querySelectorAll('[name="splitType"]').forEach((input) => input.addEventListener("change", () => {
    distributeUnequalShares(form);
    refresh();
  }));
  form.querySelectorAll('[name="participant"]').forEach((input) => input.addEventListener("change", () => {
    distributeUnequalShares(form);
    refresh();
  }));
  form.querySelectorAll('.share-input input').forEach((input) => input.addEventListener("input", refresh));
  form.querySelector('[name="currency"]')?.addEventListener("change", async () => {
    await refreshExchangeRate(form);
    refresh();
  });
  form.querySelector("[data-rate-refresh]")?.addEventListener("click", async () => {
    await refreshExchangeRate(form);
    refresh();
  });
  refreshExchangeRate(form).finally(refresh);
}

function bindRestaurantForm(form) {
  const refresh = () => updateRestaurantForm(form);
  form.querySelectorAll('.restaurant-order-row input').forEach((input) => input.addEventListener("input", refresh));
  form.querySelector('[name="currency"]')?.addEventListener("change", async () => {
    await refreshExchangeRate(form);
    refresh();
  });
  form.querySelector("[data-rate-refresh]")?.addEventListener("click", async () => {
    await refreshExchangeRate(form);
    refresh();
  });
  refreshExchangeRate(form).finally(refresh);
}

async function refreshExchangeRate(form) {
  const currencyInput = form.querySelector('[name="currency"]');
  const from = currencyCodeFromInput(currencyInput?.value || "ILS");
  if (currencyInput) currencyInput.value = from;
  const to = currencyCodeFromInput(form.dataset.baseCurrency || "ILS");
  const input = form.querySelector('[name="exchangeRate"]');
  const label = form.querySelector("[data-rate-label]");
  if (!input || !label) return;
  if (from === to) {
    input.value = "1";
    label.textContent = `1 ${from} = 1 ${to}`;
    form.dataset.rateReady = "true";
    return;
  }
  label.textContent = "מעדכן שער...";
  form.dataset.rateReady = "false";
  try {
    const data = await api(`/api/exchange-rate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    input.value = Number(data.rate).toFixed(4);
    label.textContent = `1 ${from} = ${Number(data.rate).toFixed(4)} ${to}`;
    form.dataset.rateReady = "true";
  } catch (_error) {
    try {
      const fallback = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`).then((response) => response.json());
      const rate = Number(fallback?.rates?.[to]);
      if (!rate) throw new Error("missing_rate");
      input.value = rate.toFixed(4);
      label.textContent = `1 ${from} = ${rate.toFixed(4)} ${to}`;
      form.dataset.rateReady = "true";
    } catch (__error) {
      input.value = "1";
      label.textContent = "לא הצלחנו להבים שער אוטומטי. נסה שוב בעוד רגע.";
      form.dataset.rateReady = "false";
    }
  }
}

function updateExpenseForm(form) {
  const amount = Number(form.querySelector('[name="amount"]')?.value || 0);
  const exchangeRate = Number(form.querySelector('[name="exchangeRate"]')?.value || 1);
  const baseCurrency = form.dataset.baseCurrency || "ILS";
  const converted = form.querySelector("[data-converted]");
  if (converted) converted.textContent = formatMoney(amount * exchangeRate, baseCurrency);

  const isUnequal = new FormData(form).get("splitType") === "unequal";
  form.classList.toggle("is-unequal", isUnequal);
  form.querySelectorAll(".share-input input").forEach((input) => {
    const row = input.closest(".participant-row");
    const checked = row?.querySelector('[name="participant"]')?.checked;
    input.disabled = !isUnequal || !checked;
  });
}

function updateRestaurantForm(form) {
  const total = [...form.querySelectorAll('.restaurant-order-row input')].reduce((sum, input) => sum + Number(input.value || 0), 0);
  const amountInput = form.querySelector('[name="amount"]');
  if (amountInput) amountInput.value = total.toFixed(2);
  const exchangeRate = Number(form.querySelector('[name="exchangeRate"]')?.value || 1);
  const baseCurrency = form.dataset.baseCurrency || "ILS";
  const converted = form.querySelector("[data-converted]");
  if (converted) converted.textContent = formatMoney(total * exchangeRate, baseCurrency);
}

function distributeUnequalShares(form) {
  const isUnequal = new FormData(form).get("splitType") === "unequal";
  if (!isUnequal) return;
  const amount = Math.round(Number(form.querySelector('[name="amount"]')?.value || 0) * 100);
  const checkedRows = [...form.querySelectorAll(".participant-row")].filter((row) => row.querySelector('[name="participant"]')?.checked);
  if (!amount || !checkedRows.length) return;
  const base = Math.floor(amount / checkedRows.length);
  const remainder = amount % checkedRows.length;
  checkedRows.forEach((row, index) => {
    const input = row.querySelector(".share-input input");
    if (input) input.value = ((base + (index < remainder ? 1 : 0)) / 100).toFixed(2);
  });
  form.querySelectorAll(".participant-row").forEach((row) => {
    if (!row.querySelector('[name="participant"]')?.checked) {
      const input = row.querySelector(".share-input input");
      if (input) input.value = "0";
    }
  });
}

async function submitAuth(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  if (state.authMode === "register") {
    if (payload.password !== payload.confirmPassword) {
      state.authError = "אימות הסיסמה לא תואם לסיסמה.";
      render();
      return;
    }
    payload.name = `${payload.firstName || ""} ${payload.lastName || ""}`.trim();
  }
  const endpoint = state.authMode === "register" ? "/api/auth/register" : "/api/auth/login";
  try {
    state.authError = "";
    const data = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
    state.user = data.user;
    await loadEvents();
    if (state.inviteToken) await joinInvite();
    render();
  } catch (error) {
    state.authError = authErrorText(error.message);
    render();
  }
}

async function submitProfile(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/me", {
      method: "PUT",
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        phone: form.get("phone"),
        birthDate: form.get("birthDate"),
        avatarUrl: state.profileAvatarDraft ?? form.get("avatarUrl") ?? ""
      })
    });
    state.user = data.user;
    await closeDrawerStateOnly();
    await loadEvents();
    render();
  } catch (error) {
    state.message = authErrorText(error.message);
    render();
  }
}

async function handleAvatarFile(event) {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) return;
  try {
    state.profileAvatarDraft = await imageFileToDataUrl(file);
    render();
  } catch (_error) {
    state.message = "לא הצלחנו לטעון את התמונה. נסה תמונה אחרת.";
    render();
  }
}

async function handleEventAvatarFile(event) {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) return;
  try {
    state.eventAvatarDraft = await imageFileToDataUrl(file);
    render();
  } catch (_error) {
    state.message = "לא הצלחנו לטעון את התמונה. נסה תמונה אחרת.";
    render();
  }
}

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", reject);
    reader.addEventListener("load", () => {
      const img = new Image();
      img.addEventListener("error", reject);
      img.addEventListener("load", () => {
        const maxSize = 720;
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      });
      img.src = String(reader.result || "");
    });
    reader.readAsDataURL(file);
  });
}

function bindCurrencyPickers() {
  document.querySelectorAll("[data-currency-picker]").forEach((picker) => {
    const hidden = picker.querySelector('input[type="hidden"]');
    const trigger = picker.querySelector("[data-currency-toggle]");
    const popover = picker.querySelector("[data-currency-popover]");
    const filter = picker.querySelector("[data-currency-filter]");
    const selected = picker.querySelector("[data-currency-selected]");
    const options = [...picker.querySelectorAll("[data-currency-option]")];

    const close = () => {
      popover.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
    };

    const open = () => {
      document.querySelectorAll("[data-currency-popover]").forEach((item) => {
        if (item !== popover) item.hidden = true;
      });
      popover.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      filter.value = "";
      filterCurrencyOptions(options, "");
      setTimeout(() => filter.focus(), 0);
    };

    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      popover.hidden ? open() : close();
    });

    filter.addEventListener("input", () => filterCurrencyOptions(options, filter.value));
    filter.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });

    options.forEach((option) => {
      option.addEventListener("click", () => {
        const code = option.dataset.currencyOption;
        hidden.value = code;
        selected.textContent = code;
        options.forEach((item) => item.classList.toggle("selected", item === option));
        hidden.dispatchEvent(new Event("change", { bubbles: true }));
        close();
      });
    });
  });

  if (!state.currencyOutsideBound) {
    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-currency-picker]")) return;
      document.querySelectorAll("[data-currency-popover]").forEach((popover) => {
        popover.hidden = true;
        popover.closest("[data-currency-picker]")?.querySelector("[data-currency-toggle]")?.setAttribute("aria-expanded", "false");
      });
    });
    state.currencyOutsideBound = true;
  }
}

function filterCurrencyOptions(options, query) {
  const needle = String(query || "").trim().toLowerCase();
  let visible = 0;
  options.forEach((option) => {
    const isVisible = !needle || option.dataset.currencySearch.includes(needle);
    option.hidden = !isVisible;
    option.style.display = isVisible ? "" : "none";
    if (isVisible) visible += 1;
  });
  return visible;
}

async function submitEvent(event) {
  event.preventDefault();
  const formElement = event.currentTarget;
  const isEdit = formElement.dataset.mode === "edit";
  try {
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    payload.baseCurrency = currencyCodeFromInput(payload.baseCurrency || "ILS");
    payload.spendingCurrency = currencyCodeFromInput(payload.spendingCurrency || "USD");
    payload.avatarUrl = state.eventAvatarDraft || (isEdit ? state.eventData?.event?.avatar_url || "" : "");
    payload.emoji = "";
    const data = await api(isEdit ? `/api/events/${state.activeEventId}` : "/api/events", { method: isEdit ? "PUT" : "POST", body: JSON.stringify(payload) });
    await closeDrawerStateOnly();
    await loadEvents();
    await openEvent(isEdit ? state.activeEventId : data.event.id);
  } catch (error) {
    state.message = isEdit
      ? "לא הצלחנו לשמור את השינויים. אם השרת כבר פתוח, צריך להפעיל אותו מחדש כדי לטעון את עדכון עריכת הקבוצה."
      : "לא הצלחנו ליצור את הקבוצה. נסה שוב בעוד רגע.";
    showToast("השמירה נכשלה");
    render();
  }
}

async function submitInvite(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await createInvite(Number(form.get("expiresInHours") || 168));
  await closeDrawerStateOnly();
  render();
}

async function submitExpense(event) {
  event.preventDefault();
  const element = event.currentTarget;
  await refreshExchangeRate(element);
  updateExpenseForm(element);
  const form = new FormData(element);
  const amount = Number(form.get("amount"));
  const payer = Number(form.get("payer"));
  const splitType = form.get("splitType");
  const currency = currencyCodeFromInput(form.get("currency"));
  const baseCurrency = element.dataset.baseCurrency || "ILS";
  if (currency !== baseCurrency && element.dataset.rateReady !== "true") {
    state.message = "לא הצלחנו להבים שער המרה אוטומטי. נסה שוב בעוד רגע.";
    render();
    return;
  }
  const participants = form.getAll("participant").map((id) => ({
    userId: Number(id),
    share: splitType === "unequal" ? Number(form.get(`share-${id}`) || 0) : 0
  }));
  const payload = {
    title: form.get("title"),
    amount,
    currency,
    exchangeRate: Number(form.get("exchangeRate")),
    expenseDate: form.get("expenseDate"),
    category: form.get("category"),
    splitType,
    payers: [{ userId: payer, amount }],
    participants
  };
  await api(`/api/events/${state.activeEventId}/expenses`, { method: "POST", body: JSON.stringify(payload) });
  await closeDrawerStateOnly();
  await openEvent(state.activeEventId);
}

async function submitRestaurantExpense(event) {
  event.preventDefault();
  const element = event.currentTarget;
  updateRestaurantForm(element);
  await refreshExchangeRate(element);
  updateRestaurantForm(element);
  const form = new FormData(element);
  const amount = Number(form.get("amount"));
  const payer = Number(form.get("payer"));
  const currency = currencyCodeFromInput(form.get("currency"));
  const baseCurrency = element.dataset.baseCurrency || "ILS";
  if (currency !== baseCurrency && element.dataset.rateReady !== "true") {
    state.message = "לא הצלחנו להבים שער המרה אוטומטי למסעדה. נסה שוב בעוד רגע.";
    render();
    return;
  }
  const participants = state.eventData.members
    .map((member) => ({ userId: member.id, share: Number(form.get(`order-${member.id}`) || 0) }))
    .filter((participant) => participant.share > 0);
  if (!amount || participants.length === 0) {
    state.message = "צריך להזין לפחות סכום אחד בחשבון המסעדה.";
    render();
    return;
  }
  const payload = {
    title: form.get("title") || "מסעדה",
    amount,
    currency,
    exchangeRate: Number(form.get("exchangeRate")),
    expenseDate: form.get("expenseDate"),
    category: "restaurant",
    splitType: "unequal",
    payers: [{ userId: payer, amount }],
    participants
  };
  await api(`/api/events/${state.activeEventId}/expenses`, { method: "POST", body: JSON.stringify(payload) });
  await closeDrawerStateOnly();
  await openEvent(state.activeEventId);
}

async function createRestaurantBill(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = await api(`/api/events/${state.activeEventId}/restaurant-bills`, {
    method: "POST",
    body: JSON.stringify({
      title: form.get("title") || "מסעדה פתוחה",
      currency: currencyCodeFromInput(form.get("currency") || state.eventData.event.base_currency)
    })
  });
  state.eventData = data.event;
  state.activeRestaurantBillId = data.bill.id;
  await closeDrawerStateOnly();
  state.message = "נפתחה מסעדה חדשה. כל אחד יכול להיכנס אליה ולהזין כמה הזמין.";
  render({ cards: true });
}

async function submitRestaurantItem(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = await api(`/api/events/${state.activeEventId}/restaurant-bills/${state.activeRestaurantBillId}/items/me`, {
    method: "PUT",
    body: JSON.stringify({
      amount: Number(form.get("amount") || 0),
      currency: currencyCodeFromInput(form.get("currency"))
    })
  });
  state.eventData = data.event;
  await closeDrawerStateOnly();
  state.message = "החלק שלך במסעדה נשמר.";
  render();
}

async function submitRestaurantPayment(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = await api(`/api/events/${state.activeEventId}/restaurant-bills/${state.activeRestaurantBillId}/pay`, {
    method: "POST",
    body: JSON.stringify({
      payerId: Number(form.get("payerId")),
      currency: currencyCodeFromInput(form.get("currency"))
    })
  });
  state.eventData = data.event;
  await closeDrawerStateOnly();
  state.activeRestaurantBillId = null;
  state.message = "המסעדה נסגרה ונוספה כהוצאה לפי הסכומים האישיים.";
  render();
}

async function submitSettlementPayment(event) {
  event.preventDefault();
  const flow = state.activeSettlementFlow;
  const form = new FormData(event.currentTarget);
  const amount = Math.min(Number(form.get("amount") || 0), Number(flow.amount || 0));
  const data = await api(`/api/events/${state.activeEventId}/settlement-payments`, {
    method: "POST",
    body: JSON.stringify({
      fromUserId: flow.fromUserId,
      toUserId: flow.toUserId,
      amount
    })
  });
  state.eventData = data.event;
  await closeDrawerStateOnly();
  state.activeSettlementFlow = null;
  state.message = "התשלוא נשמר והחוב עודכן.";
  render();
}

async function deleteRestaurantBill(id, element) {
  await motion.cardRemove(element, async () => {
    const data = await api(`/api/events/${state.activeEventId}/restaurant-bills/${id}`, { method: "DELETE" });
    state.eventData = data.event;
    state.message = "המסעדה הריקה נמחקה.";
    render({ cards: true });
  });
}

async function deleteEvent(id) {
  const event = state.events.find((item) => String(item.id) === String(id));
  const ok = confirm(`למחוק את הקבוצה "${event?.name || ""}"? כל ההוצאות, המסעדות וההזמנות שלה יימחקו.`);
  if (!ok) return;
  await api(`/api/events/${id}`, { method: "DELETE" });
  if (String(state.activeEventId) === String(id)) {
    state.activeEventId = null;
    state.eventData = null;
  }
  state.message = "הקבוצה נמחקה.";
  await loadEvents();
  render();
}

async function removeEventMember(memberId) {
  try {
    const data = await api(`/api/events/${state.activeEventId}/members/${memberId}`, { method: "DELETE" });
    state.eventData = data.event;
    state.message = "";
    showToast("המשתתף הוסר מהקבוצה");
    render();
  } catch (error) {
    const blockedErrors = ["member_has_open_balance", "member_has_open_restaurant_amount"];
    state.message = blockedErrors.includes(error.message)
      ? "אי אפשר להסיר משתתף שיש לו חוב או סכום פתוח בקבוצה."
      : "לא הצלחנו להסיר את המשתתף. נסה שוב בעוד רגע.";
    showToast("ההסרה נכשלה");
    render();
  }
}

async function loadEvents() {
  const data = await api("/api/events");
  state.events = await Promise.all(
    data.events.map(async (event) => {
      if (event.userBalanceCents !== undefined && event.totalExpenses !== undefined) return event;
      try {
        const settlement = await api(`/api/events/${event.id}/settlement`);
        const userBalance = settlement.balances.find((balance) => balance.userId === state.user.id);
        return {
          ...event,
          totalExpenses: settlement.totalExpenses,
          userBalance: userBalance?.balance || 0,
          userBalanceCents: userBalance?.balanceCents || 0
        };
      } catch (_error) {
        return { ...event, totalExpenses: 0, userBalance: 0, userBalanceCents: 0 };
      }
    })
  );
}

async function loadInviteInfo() {
  try {
    const data = await api(`/api/invites/${state.inviteToken}`);
    state.inviteInfo = data.invite;
  } catch (_error) {
    state.inviteInfo = null;
  }
}

function openDrawer(drawer) {
  state.drawer = drawer;
  render({ drawer: true });
}

async function closeDrawer() {
  await motion.sheetClose();
  state.drawer = null;
  state.profileAvatarDraft = null;
  state.eventAvatarDraft = null;
  render();
}

async function closeDrawerStateOnly() {
  await motion.sheetClose();
  state.drawer = null;
  state.profileAvatarDraft = null;
  state.eventAvatarDraft = null;
}

async function openEvent(id) {
  const eventData = await api(`/api/events/${id}`);
  await motion.page("forward", () => {
    state.activeEventId = id;
    state.eventData = eventData;
    state.message = "";
    render({ cards: true });
  });
}

async function deleteExpense(id, element) {
  await motion.cardRemove(element, async () => {
    await api(`/api/events/${state.activeEventId}/expenses/${id}`, { method: "DELETE" });
    await openEvent(state.activeEventId);
  });
}

async function createInvite() {
  const expiresInHours = 24;
  const data = await api(`/api/events/${state.activeEventId}/invites`, { method: "POST", body: JSON.stringify({ expiresInHours }) });
  state.message = "";
  try {
    await copyText(data.inviteUrl);
  } catch (_error) {
    // Browser automation and some local contexts can block clipboard writes,
    // but the invite was still created and real HTTPS taps can copy normally.
  }
  showToast("הקישור הועתק");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.inset = "0 auto auto 0";
  input.style.width = "1px";
  input.style.height = "1px";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.focus();
  input.select();
  input.setSelectionRange(0, input.value.length);
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("copy_failed");
}

function showToast(text) {
  clearTimeout(toastTimer);
  state.toast = text;
  toastTimer = setTimeout(() => {
    state.toast = "";
    render();
  }, 2200);
}

function waitForAnimation(element, fallbackMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    element.addEventListener("transitionend", finish, { once: true });
    element.addEventListener("animationend", finish, { once: true });
    setTimeout(finish, fallbackMs);
  });
}

async function joinInvite() {
  const data = await api(`/api/invites/${state.inviteToken}/join`, { method: "POST", body: "{}" });
  state.inviteToken = null;
  history.replaceState(null, "", "/");
  await loadEvents();
  await openEvent(data.event.id);
}

async function logout() {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  state.user = null;
  state.events = [];
  state.eventData = null;
}

function formatMoney(value, currency) {
  const amount = Number(value || 0);
  if (currency === "₪" || currency === "ILS") return `${amount < 0 ? "-" : ""}₪${fmt.format(Math.abs(amount))}`;
  return `${fmt.format(value)} ${currency}`;
}

function currencySearchInput(name, selected = "ILS") {
  const selectedCode = currencyCodeFromInput(selected);
  const selectedCurrency = currencyOptions().find((currency) => currency.code === selectedCode) || currencyOptions()[0];
  return `
    <div class="currency-picker" data-currency-picker>
      <input type="hidden" name="${name}" value="${escapeHtml(selectedCurrency.code)}" />
      <button class="currency-trigger" type="button" data-currency-toggle aria-haspopup="listbox" aria-expanded="false">
        <span data-currency-selected>${escapeHtml(selectedCurrency.code)}</span>
        ${iconSvg("chevron")}
      </button>
      <div class="currency-popover" data-currency-popover hidden>
        <input class="currency-filter" type="text" autocomplete="off" inputmode="search" placeholder="חפש לפי קוד או שם..." data-currency-filter />
        <div class="currency-options" role="listbox" data-currency-list>
          ${currencyOptions()
            .map(
              (currency) => `
                <button type="button" role="option" class="currency-option${currency.code === selectedCurrency.code ? " selected" : ""}" data-currency-option="${currency.code}" data-currency-search="${escapeHtml(`${currency.code} ${currency.name}`.toLowerCase())}">
                  <strong>${currency.code}</strong>
                  <span>${escapeHtml(currency.name)}</span>
                </button>`
            )
            .join("")}
        </div>
      </div>
    </div>`;
}

function currencyCodeFromInput(value) {
  const normalized = String(value || "ILS").trim().toUpperCase();
  const exactCode = /^[A-Z]{3}$/.test(normalized) ? normalized : "";
  if (exactCode && currencyOptions().some((currency) => currency.code === exactCode)) return exactCode;
  const prefixedCode = normalized.match(/^([A-Z]{3})\b/)?.[1];
  if (prefixedCode && currencyOptions().some((currency) => currency.code === prefixedCode)) return prefixedCode;
  const byName = currencyOptions().find((currency) => currency.name.toUpperCase().includes(normalized));
  return byName?.code || prefixedCode || "ILS";
}

function currencyOptions() {
  return [
    ["ILS", "Israeli New Shekel"],
    ["USD", "US Dollar"],
    ["EUR", "Euro"],
    ["GBP", "British Pound"],
    ["GEL", "Georgian Lari"],
    ["AED", "UAE Dirham"],
    ["AFN", "Afghan Afghani"],
    ["ALL", "Albanian Lek"],
    ["AMD", "Armenian Dram"],
    ["ANG", "Netherlands Antillean Guilder"],
    ["AOA", "Angolan Kwanza"],
    ["ARS", "Argentine Peso"],
    ["AUD", "Australian Dollar"],
    ["AWG", "Aruban Florin"],
    ["AZN", "Azerbaijani Manat"],
    ["BAM", "Bosnia-Herzegovina Convertible Mark"],
    ["BBD", "Barbadian Dollar"],
    ["BDT", "Bangladeshi Taka"],
    ["BGN", "Bulgarian Lev"],
    ["BHD", "Bahraini Dinar"],
    ["BIF", "Burundian Franc"],
    ["BMD", "Bermudian Dollar"],
    ["BND", "Brunei Dollar"],
    ["BOB", "Bolivian Boliviano"],
    ["BRL", "Brazilian Real"],
    ["BSD", "Bahamian Dollar"],
    ["BTN", "Bhutanese Ngultrum"],
    ["BWP", "Botswana Pula"],
    ["BYN", "Belarusian Ruble"],
    ["BZD", "Belize Dollar"],
    ["CAD", "Canadian Dollar"],
    ["CDF", "Congolese Franc"],
    ["CHF", "Swiss Franc"],
    ["CLP", "Chilean Peso"],
    ["CNY", "Chinese Yuan"],
    ["COP", "Colombian Peso"],
    ["CRC", "Costa Rican Colon"],
    ["CUP", "Cuban Peso"],
    ["CVE", "Cape Verdean Escudo"],
    ["CZK", "Czech Koruna"],
    ["DJF", "Djiboutian Franc"],
    ["DKK", "Danish Krone"],
    ["DOP", "Dominican Peso"],
    ["DZD", "Algerian Dinar"],
    ["EGP", "Egyptian Pound"],
    ["ERN", "Eritrean Nakfa"],
    ["ETB", "Ethiopian Birr"],
    ["FJD", "Fijian Dollar"],
    ["FKP", "Falkland Islands Pound"],
    ["FOK", "Faroese Króna"],
    ["GGP", "Guernsey Pound"],
    ["GHS", "Ghanaian Cedi"],
    ["GIP", "Gibraltar Pound"],
    ["GMD", "Gambian Dalasi"],
    ["GNF", "Guinean Franc"],
    ["GTQ", "Guatemalan Quetzal"],
    ["GYD", "Guyanese Dollar"],
    ["HKD", "Hong Kong Dollar"],
    ["HNL", "Honduran Lempira"],
    ["HRK", "Croatian Kuna"],
    ["HTG", "Haitian Gourde"],
    ["HUF", "Hungarian Forint"],
    ["IDR", "Indonesian Rupiah"],
    ["IMP", "Isle of Man Pound"],
    ["INR", "Indian Rupee"],
    ["IQD", "Iraqi Dinar"],
    ["IRR", "Iranian Rial"],
    ["ISK", "Icelandic Krona"],
    ["JEP", "Jersey Pound"],
    ["JMD", "Jamaican Dollar"],
    ["JOD", "Jordanian Dinar"],
    ["JPY", "Japanese Yen"],
    ["KES", "Kenyan Shilling"],
    ["KGS", "Kyrgyzstani Som"],
    ["KHR", "Cambodian Riel"],
    ["KID", "Kiribati Dollar"],
    ["KMF", "Comorian Franc"],
    ["KRW", "South Korean Won"],
    ["KWD", "Kuwaiti Dinar"],
    ["KYD", "Cayman Islands Dollar"],
    ["KZT", "Kazakhstani Tenge"],
    ["LAK", "Lao Kip"],
    ["LBP", "Lebanese Pound"],
    ["LKR", "Sri Lankan Rupee"],
    ["LRD", "Liberian Dollar"],
    ["LSL", "Lesotho Loti"],
    ["LYD", "Libyan Dinar"],
    ["MAD", "Moroccan Dirham"],
    ["MDL", "Moldovan Leu"],
    ["MGA", "Malagasy Ariary"],
    ["MKD", "Macedonian Denar"],
    ["MMK", "Myanmar Kyat"],
    ["MNT", "Mongolian Tugrik"],
    ["MOP", "Macanese Pataca"],
    ["MRU", "Mauritanian Ouguiya"],
    ["MUR", "Mauritian Rupee"],
    ["MVR", "Maldivian Rufiyaa"],
    ["MWK", "Malawian Kwacha"],
    ["MXN", "Mexican Peso"],
    ["MYR", "Malaysian Ringgit"],
    ["MZN", "Mozambican Metical"],
    ["NAD", "Namibian Dollar"],
    ["NGN", "Nigerian Naira"],
    ["NIO", "Nicaraguan Cordoba"],
    ["NOK", "Norwegian Krone"],
    ["NPR", "Nepalese Rupee"],
    ["NZD", "New Zealand Dollar"],
    ["OMR", "Omani Rial"],
    ["PAB", "Panamanian Balboa"],
    ["PEN", "Peruvian Sol"],
    ["PGK", "Papua New Guinean Kina"],
    ["PHP", "Philippine Peso"],
    ["PKR", "Pakistani Rupee"],
    ["PLN", "Polish Zloty"],
    ["PYG", "Paraguayan Guarani"],
    ["QAR", "Qatari Riyal"],
    ["RON", "Romanian Leu"],
    ["RSD", "Serbian Dinar"],
    ["RUB", "Russian Ruble"],
    ["RWF", "Rwandan Franc"],
    ["SAR", "Saudi Riyal"],
    ["SBD", "Solomon Islands Dollar"],
    ["SCR", "Seychellois Rupee"],
    ["SDG", "Sudanese Pound"],
    ["SEK", "Swedish Krona"],
    ["SGD", "Singapore Dollar"],
    ["SHP", "Saint Helena Pound"],
    ["SLE", "Sierra Leonean Leone"],
    ["SOS", "Somali Shilling"],
    ["SRD", "Surinamese Dollar"],
    ["SSP", "South Sudanese Pound"],
    ["STN", "São Tomé and Príncipe Dobra"],
    ["SYP", "Syrian Pound"],
    ["SZL", "Eswatini Lilangeni"],
    ["THB", "Thai Baht"],
    ["TJS", "Tajikistani Somoni"],
    ["TMT", "Turkmenistani Manat"],
    ["TND", "Tunisian Dinar"],
    ["TOP", "Tongan Paʻanga"],
    ["TRY", "Turkish Lira"],
    ["TTD", "Trinidad and Tobago Dollar"],
    ["TVD", "Tuvaluan Dollar"],
    ["TWD", "New Taiwan Dollar"],
    ["TZS", "Tanzanian Shilling"],
    ["UAH", "Ukrainian Hryvnia"],
    ["UGX", "Ugandan Shilling"],
    ["UYU", "Uruguayan Peso"],
    ["UZS", "Uzbekistani Som"],
    ["VES", "Venezuelan Bolívar"],
    ["VND", "Vietnamese Dong"],
    ["VUV", "Vanuatu Vatu"],
    ["WST", "Samoan Tala"],
    ["XAF", "Central African CFA Franc"],
    ["XCD", "East Caribbean Dollar"],
    ["XCG", "Caribbean Guilder"],
    ["XOF", "West African CFA Franc"],
    ["XPF", "CFP Franc"],
    ["YER", "Yemeni Rial"],
    ["ZAR", "South African Rand"],
    ["ZMW", "Zambian Kwacha"],
    ["ZWL", "Zimbabwean Dollar"]
  ].map(([code, name]) => ({ code, name }));
}

function categoryOptions() {
  return [
    { value: "restaurant", label: "מסעדות", icon: iconSvg("restaurant") },
    { value: "taxi", label: "מוניות", icon: iconSvg("taxi") },
    { value: "transport", label: "תחבורה", icon: iconSvg("transport") },
    { value: "fuel", label: "דלק", icon: iconSvg("fuel") },
    { value: "lodging", label: "לינה", icon: iconSvg("lodging") },
    { value: "groceries", label: "סופר", icon: iconSvg("groceries") },
    { value: "flights", label: "טיסות", icon: iconSvg("flights") },
    { value: "tickets", label: "כרטיסים", icon: iconSvg("tickets") },
    { value: "activities", label: "אטרקציות", icon: iconSvg("activities") },
    { value: "parking", label: "חניה", icon: iconSvg("parking") },
    { value: "shopping", label: "קניות", icon: iconSvg("shopping") },
    { value: "other", label: "אחר", icon: iconSvg("other") }
  ];
}

function categoryMeta(category) {
  return categoryOptions().find((option) => option.value === category) || categoryOptions().find((option) => option.value === "other");
}

function categoryName(category) {
  return {
    food: "מסעדות",
    restaurant: "מסעדות",
    taxi: "מוניות",
    transport: "תחבורה",
    fuel: "דלק",
    lodging: "לינה",
    groceries: "סופר",
    flights: "טיסות",
    tickets: "כרטיסים",
    activities: "אטרקציות",
    parking: "חניה",
    shopping: "קניות",
    other: "אחר"
  }[category] || category;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(name) {
  const parts = String(name || "משתמש").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join("") || "מ";
}

function avatarMarkup(user, size = "large") {
  const className = size === "mini" ? "profile-avatar-mini" : "profile-avatar";
  if (user?.avatarUrl) return `<span class="${className}"><img src="${escapeHtml(user.avatarUrl)}" alt="" /></span>`;
  if (size === "mini") return `<span class="${className}">${iconSvg("user")}</span>`;
  return `<span class="${className}">${initials(user?.name)}</span>`;
}

function memberAvatarMarkup(member, size = "regular") {
  const className = size === "mini" ? "member-dot member-dot-mini" : "member-dot";
  const name = member?.name || "משתמש";
  if (member?.avatarUrl) return `<span class="${className}" title="${escapeHtml(name)}"><img src="${escapeHtml(member.avatarUrl)}" alt="${escapeHtml(name)}" /></span>`;
  return `<span class="${className}" title="${escapeHtml(name)}">${escapeHtml(initials(name))}</span>`;
}

function participantAvatarMarkup(member) {
  const name = member?.name || "משתמש";
  if (member?.avatarUrl) return `<span title="${escapeHtml(name)}"><img src="${escapeHtml(member.avatarUrl)}" alt="${escapeHtml(name)}" /></span>`;
  return `<span title="${escapeHtml(name)}">${escapeHtml(initials(name))}</span>`;
}

function eventVisual(event, className = "group-thumb") {
  if (event?.avatar_url) return `<span class="${className}"><img src="${escapeHtml(event.avatar_url)}" alt="" /></span>`;
  return `<span class="${className}">${iconSvg("wallet")}</span>`;
}

function eventHeroBackground(event) {
  if (!event?.avatar_url) return "";
  return `<div class="event-hero-bg" style="--event-bg-image: url('${escapeHtml(event.avatar_url)}')" aria-hidden="true"></div>`;
}

function authErrorText(code) {
  return {
    invalid_credentials: "האימייל או הסיסמה לא נכונים.",
    email_exists: "כבר קיים חשבון עם האימייל הזה.",
    missing_fields: "צריך למלא את כל השדות."
  }[code] || "לא הצלחנו להשלים את הפעולה. נסה שוב.";
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

function authField(name, label, placeholder, icon, type, autocomplete) {
  return `
    <label class="auth-field">
      <input name="${name}" type="${type}" required autocomplete="${autocomplete}" placeholder="${placeholder}" />
      <span>${label}</span>
      <i aria-hidden="true">${iconSvg(icon)}</i>
    </label>
  `;
}

function iconSvg(name) {
  const icons = {
    user: "bi-person",
    userPlus: "bi-person-plus",
    users: "bi-people",
    calendar: "bi-calendar3",
    phone: "bi-telephone",
    mail: "bi-envelope",
    lock: "bi-lock",
    close: "bi-x-lg",
    check: "bi-check-lg",
    sync: "bi-arrow-repeat",
    bell: "bi-bell",
    wallet: "bi-wallet2",
    chart: "bi-bar-chart",
    home: "bi-house",
    edit: "bi-pencil-square",
    plus: "bi-plus-lg",
    receipt: "bi-receipt",
    trash: "bi-trash3",
    more: "bi-three-dots-vertical",
    chevron: "bi-chevron-down",
    back: "bi-arrow-right",
    arrow: "bi-arrow-left",
    settlementArrow: "bi-arrow-right",
    share: "bi-share",
    restaurant: "bi-cup-hot",
    taxi: "bi-taxi-front",
    transport: "bi-train-front",
    fuel: "bi-fuel-pump",
    lodging: "bi-house-door",
    groceries: "bi-basket",
    flights: "bi-airplane",
    tickets: "bi-ticket-perforated",
    activities: "bi-compass",
    parking: "bi-p-square",
    shopping: "bi-bag",
    other: "bi-three-dots"
  };
  return `<span class="bi ${icons[name] || icons.other}" aria-hidden="true"></span>`;
}
