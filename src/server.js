import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { clearSessionCookie, createSession, hashPassword, readCookies, sessionCookie, verifyPassword } from "./auth.js";
import { getConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { calculateSettlement, cents } from "./settlement.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = getConfig();
const db = openDatabase(config.dbPath);
const app = express();
const ADMIN_COOKIE = "admin_sid";
const ADMIN_SESSION_HOURS = 12;

if (config.trustProxy) app.set("trust proxy", 1);
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(attachUser);

app.post("/api/auth/register", (req, res) => {
  const { email, password, name, phone, birthDate } = req.body || {};
  if (!email || !password || !name) return res.status(400).json({ error: "missing_fields" });

  try {
    const result = db
      .prepare("INSERT INTO users (email, name, phone, birth_date, password_hash) VALUES (?, ?, ?, ?, ?)")
      .run(
        String(email).trim().toLowerCase(),
        String(name).trim(),
        cleanText(phone),
        cleanText(birthDate),
        hashPassword(String(password))
      );
    const session = createSession(db, result.lastInsertRowid);
    res.setHeader("Set-Cookie", sessionCookie(session, config.secureCookies));
    res.status(201).json({ user: publicUser(getUser(result.lastInsertRowid)) });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) return res.status(409).json({ error: "email_exists" });
    throw error;
  }
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(String(email || "").trim());
  if (!user || !verifyPassword(String(password || ""), user.password_hash)) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  const session = createSession(db, user.id);
  res.setHeader("Set-Cookie", sessionCookie(session, config.secureCookies));
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", requireUser, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(req.sessionId);
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

app.put("/api/me", requireUser, (req, res) => {
  const name = cleanText(req.body?.name);
  const email = String(req.body?.email || "").trim().toLowerCase();
  const phone = cleanText(req.body?.phone);
  const birthDate = cleanText(req.body?.birthDate);
  const avatarUrl = cleanAvatar(req.body?.avatarUrl);
  if (!name || !email) return res.status(400).json({ error: "missing_fields" });

  try {
    db.prepare("UPDATE users SET name = ?, email = ?, phone = ?, birth_date = ?, avatar_url = ? WHERE id = ?").run(
      name,
      email,
      phone,
      birthDate,
      avatarUrl,
      req.user.id
    );
    res.json({ user: publicUser(getUser(req.user.id)) });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) return res.status(409).json({ error: "email_exists" });
    throw error;
  }
});

app.get("/api/events", requireUser, (req, res) => {
  const events = db
    .prepare(
      `SELECT e.*, COUNT(em.user_id) AS member_count
       FROM events e
       JOIN event_members em ON em.event_id = e.id
       WHERE e.id IN (SELECT event_id FROM event_members WHERE user_id = ?)
       GROUP BY e.id
       ORDER BY e.created_at DESC`
    )
    .all(req.user.id);
  res.json({
    events: events.map((event) => {
      const settlement = buildSettlement(event.id);
      const userBalance = settlement.balances.find((balance) => balance.userId === req.user.id);
      return {
        ...event,
        members: getMemberPreview(event.id),
        totalExpenses: settlement.totalExpenses,
        userBalance: userBalance?.balance || 0,
        userBalanceCents: userBalance?.balanceCents || 0
      };
    })
  });
});

app.post("/api/events", requireUser, (req, res) => {
  const { name, baseCurrency = "ILS", spendingCurrency = "USD", avatarUrl, emoji } = req.body || {};
  if (!name) return res.status(400).json({ error: "missing_name" });

  const tx = db.transaction(() => {
    const event = db
      .prepare("INSERT INTO events (owner_id, name, base_currency, spending_currency, avatar_url, emoji) VALUES (?, ?, ?, ?, ?, ?)")
      .run(
        req.user.id,
        String(name).trim(),
        normalizeCurrency(baseCurrency, "ILS"),
        normalizeCurrency(spendingCurrency, "USD"),
        cleanAvatar(avatarUrl),
        cleanEmoji(emoji)
      );
    db.prepare("INSERT INTO event_members (event_id, user_id, role) VALUES (?, ?, 'owner')").run(event.lastInsertRowid, req.user.id);
    return getEventForUser(event.lastInsertRowid, req.user.id);
  });

  res.status(201).json({ event: tx() });
});

app.get("/api/events/:id", requireUser, requireEventMember, (req, res) => {
  res.json(buildEventPayload(req.event.id));
});

app.put("/api/events/:id", requireUser, requireEventMember, (req, res) => {
  if (Number(req.event.owner_id) !== Number(req.user.id)) return res.status(403).json({ error: "owner_required" });
  const name = cleanText(req.body?.name);
  const baseCurrency = normalizeCurrency(req.body?.baseCurrency, req.event.base_currency || "ILS");
  const spendingCurrency = normalizeCurrency(req.body?.spendingCurrency, req.event.spending_currency || "USD");
  const avatarUrl = cleanAvatar(req.body?.avatarUrl);
  const emoji = cleanEmoji(req.body?.emoji);
  if (!name) return res.status(400).json({ error: "missing_name" });
  db.prepare(
    `UPDATE events
     SET name = ?, base_currency = ?, spending_currency = ?, avatar_url = ?, emoji = ?
     WHERE id = ? AND owner_id = ?`
  ).run(name, baseCurrency, spendingCurrency, avatarUrl, emoji, req.event.id, req.user.id);
  res.json({ event: getEventForUser(req.event.id, req.user.id), payload: buildEventPayload(req.event.id) });
});

app.delete("/api/events/:id", requireUser, requireEventMember, (req, res) => {
  if (Number(req.event.owner_id) !== Number(req.user.id)) return res.status(403).json({ error: "owner_required" });
  db.prepare("DELETE FROM events WHERE id = ? AND owner_id = ?").run(req.event.id, req.user.id);
  res.json({ ok: true });
});

app.delete("/api/events/:id/members/:memberId", requireUser, requireEventMember, (req, res) => {
  if (Number(req.event.owner_id) !== Number(req.user.id)) return res.status(403).json({ error: "owner_required" });
  const memberId = Number(req.params.memberId);
  if (!Number.isInteger(memberId)) return res.status(400).json({ error: "invalid_member" });
  if (memberId === Number(req.event.owner_id)) return res.status(400).json({ error: "cannot_remove_owner" });

  const member = db.prepare("SELECT * FROM event_members WHERE event_id = ? AND user_id = ?").get(req.event.id, memberId);
  if (!member) return res.status(404).json({ error: "member_not_found" });

  const balance = buildSettlement(req.event.id).balances.find((item) => Number(item.userId) === memberId);
  if (balance && balance.balanceCents !== 0) return res.status(409).json({ error: "member_has_open_balance" });

  const openRestaurantAmount = db
    .prepare(
      `SELECT COALESCE(SUM(restaurant_bill_items.amount_cents), 0) AS total
       FROM restaurant_bill_items
       JOIN restaurant_bills ON restaurant_bills.id = restaurant_bill_items.bill_id
       WHERE restaurant_bills.event_id = ?
         AND restaurant_bills.status = 'open'
         AND restaurant_bill_items.user_id = ?`
    )
    .get(req.event.id, memberId).total;
  if (openRestaurantAmount > 0) return res.status(409).json({ error: "member_has_open_restaurant_amount" });

  db.prepare("DELETE FROM event_members WHERE event_id = ? AND user_id = ?").run(req.event.id, memberId);
  res.json({ ok: true, event: buildEventPayload(req.event.id) });
});

app.post("/api/events/:id/invites", requireUser, requireEventMember, (req, res) => {
  if (Number(req.event.owner_id) !== Number(req.user.id)) return res.status(403).json({ error: "owner_required" });
  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = inviteExpiresAt();
  db.transaction(() => {
    db.prepare("UPDATE event_invites SET revoked_at = CURRENT_TIMESTAMP WHERE event_id = ? AND revoked_at IS NULL").run(req.event.id);
    db.prepare("INSERT INTO event_invites (token, event_id, created_by, expires_at) VALUES (?, ?, ?, ?)").run(token, req.event.id, req.user.id, expiresAt);
  })();
  res.status(201).json({ token, inviteUrl: `${config.appUrl}/invite/${token}`, eventName: req.event.name, expiresAt });
});

app.get("/api/invites/:token", (req, res) => {
  const invite = db
    .prepare(
      `SELECT event_invites.token, event_invites.expires_at AS expiresAt, events.id AS eventId, events.name AS eventName, events.base_currency AS eventCurrency
       FROM event_invites
       JOIN events ON events.id = event_invites.event_id
       WHERE event_invites.token = ?
         AND event_invites.revoked_at IS NULL
         AND (event_invites.expires_at IS NULL OR event_invites.expires_at > CURRENT_TIMESTAMP)`
    )
    .get(req.params.token);
  if (!invite) return res.status(404).json({ error: "invite_not_found" });
  res.json({ invite });
});

app.post("/api/invites/:token/join", requireUser, (req, res) => {
  const invite = db
    .prepare(
      `SELECT *
       FROM event_invites
       WHERE token = ?
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`
    )
    .get(req.params.token);
  if (!invite) return res.status(404).json({ error: "invite_not_found" });
  db.prepare("INSERT OR IGNORE INTO event_members (event_id, user_id) VALUES (?, ?)").run(invite.event_id, req.user.id);
  res.json({ event: getEventForUser(invite.event_id, req.user.id) });
});

app.post("/api/events/:id/expenses", requireUser, requireEventMember, async (req, res, next) => {
  try {
    const expense = await saveExpense({ eventId: req.event.id, userId: req.user.id, input: req.body });
    res.status(201).json({ expense, settlement: buildSettlement(req.event.id) });
  } catch (error) {
    next(error);
  }
});

app.put("/api/events/:id/expenses/:expenseId", requireUser, requireEventMember, async (req, res, next) => {
  try {
    const existing = db.prepare("SELECT * FROM expenses WHERE id = ? AND event_id = ?").get(req.params.expenseId, req.event.id);
    if (!existing) return res.status(404).json({ error: "expense_not_found" });
    const expense = await saveExpense({ eventId: req.event.id, userId: req.user.id, expenseId: existing.id, input: req.body });
    res.json({ expense, settlement: buildSettlement(req.event.id) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/events/:id/expenses/:expenseId", requireUser, requireEventMember, (req, res) => {
  const result = db.prepare("DELETE FROM expenses WHERE id = ? AND event_id = ?").run(req.params.expenseId, req.event.id);
  if (result.changes === 0) return res.status(404).json({ error: "expense_not_found" });
  res.json({ ok: true, settlement: buildSettlement(req.event.id) });
});

app.get("/api/events/:id/settlement", requireUser, requireEventMember, (req, res) => {
  res.json(buildSettlement(req.event.id));
});

app.post("/api/events/:id/settlement-payments", requireUser, requireEventMember, (req, res) => {
  const fromUserId = Number(req.body?.fromUserId);
  const toUserId = Number(req.body?.toUserId);
  const amountCents = cents(req.body?.amount || 0);
  if (!fromUserId || !toUserId || fromUserId === toUserId || amountCents <= 0) return res.status(400).json({ error: "invalid_settlement_payment" });
  assertMembers(req.event.id, [fromUserId, toUserId]);
  if (toUserId !== Number(req.user.id)) return res.status(403).json({ error: "receiver_required" });
  db.prepare(
    "INSERT INTO settlement_payments (event_id, from_user_id, to_user_id, amount_cents, created_by) VALUES (?, ?, ?, ?, ?)"
  ).run(req.event.id, fromUserId, toUserId, amountCents, req.user.id);
  res.status(201).json({ event: buildEventPayload(req.event.id), settlement: buildSettlement(req.event.id) });
});

app.post("/api/events/:id/restaurant-bills", requireUser, requireEventMember, (req, res) => {
  const title = String(req.body?.title || "מסעדה פתוחה").trim();
  const currency = String(req.body?.currency || req.event.base_currency || "ILS").trim().toUpperCase();
  const billId = db
    .prepare("INSERT INTO restaurant_bills (event_id, title, currency, created_by) VALUES (?, ?, ?, ?)")
    .run(req.event.id, title, currency, req.user.id).lastInsertRowid;
  res.status(201).json({ bill: getRestaurantBill(req.event.id, billId), event: buildEventPayload(req.event.id) });
});

app.put("/api/events/:id/restaurant-bills/:billId/items/me", requireUser, requireEventMember, (req, res) => {
  const bill = getOpenRestaurantBill(req.event.id, req.params.billId);
  if (!bill) return res.status(404).json({ error: "restaurant_bill_not_found" });
  const amountCents = cents(req.body?.amount || 0);
  const currency = String(req.body?.currency || bill.currency || req.event.base_currency || "ILS").trim().toUpperCase();
  db.prepare(
    `INSERT INTO restaurant_bill_items (bill_id, user_id, amount_cents, currency, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(bill_id, user_id) DO UPDATE SET amount_cents = excluded.amount_cents, currency = excluded.currency, updated_at = CURRENT_TIMESTAMP`
  ).run(bill.id, req.user.id, amountCents, currency);
  db.prepare("UPDATE restaurant_bills SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(bill.id);
  res.json({ bill: getRestaurantBill(req.event.id, bill.id), event: buildEventPayload(req.event.id) });
});

app.delete("/api/events/:id/restaurant-bills/:billId", requireUser, requireEventMember, (req, res) => {
  const bill = getOpenRestaurantBill(req.event.id, req.params.billId);
  if (!bill) return res.status(404).json({ error: "restaurant_bill_not_found" });
  const total = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM restaurant_bill_items WHERE bill_id = ?").get(bill.id).total;
  if (total > 0) return res.status(400).json({ error: "restaurant_bill_not_empty" });
  db.prepare("DELETE FROM restaurant_bills WHERE id = ?").run(bill.id);
  res.json({ ok: true, event: buildEventPayload(req.event.id) });
});

app.post("/api/events/:id/restaurant-bills/:billId/pay", requireUser, requireEventMember, async (req, res, next) => {
  try {
    const bill = getOpenRestaurantBill(req.event.id, req.params.billId);
    if (!bill) return res.status(404).json({ error: "restaurant_bill_not_found" });
    const payerId = Number(req.body?.payerId || req.user.id);
    assertMembers(req.event.id, [payerId]);
    const currency = String(req.body?.currency || bill.currency || req.event.base_currency || "ILS").trim().toUpperCase();
    const items = getRestaurantBillItems(bill.id).filter((item) => item.amountCents > 0);
    if (!items.length) return res.status(400).json({ error: "empty_restaurant_bill" });
    const convertedItems = [];
    for (const item of items) {
      const rate = item.currency === currency ? 1 : (await getExchangeRate(item.currency, currency)).rate;
      convertedItems.push({ ...item, share: Math.round(item.amountCents * rate) / 100 });
    }
    const amount = convertedItems.reduce((sum, item) => sum + item.share, 0);
    const expense = await saveExpense({
      eventId: req.event.id,
      userId: req.user.id,
      input: {
        title: bill.title,
        amount,
        currency,
        expenseDate: new Date().toISOString().slice(0, 10),
        category: "restaurant",
        splitType: "unequal",
        payers: [{ userId: payerId, amount }],
        participants: convertedItems.map((item) => ({ userId: item.userId, share: item.share }))
      }
    });
    db.prepare(
      `UPDATE restaurant_bills
       SET status = 'paid', paid_by = ?, expense_id = ?, currency = ?, paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(payerId, expense.id, currency, bill.id);
    res.json({ bill: getRestaurantBill(req.event.id, bill.id), expense, event: buildEventPayload(req.event.id) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/exchange-rate", requireUser, async (req, res, next) => {
  try {
    const from = String(req.query.from || "ILS").trim().toUpperCase();
    const to = String(req.query.to || "ILS").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return res.status(400).json({ error: "invalid_currency" });
    const quote = await getExchangeRate(from, to);
    res.json(quote);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/login", (req, res) => {
  const account = getAdminAccount();
  if (!account) return res.status(503).json({ error: "admin_not_configured" });
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!safeEqual(username, account.username) || !verifyPassword(password, account.password_hash)) {
    return res.status(401).json({ error: "invalid_admin_credentials" });
  }
  res.setHeader("Set-Cookie", adminSessionCookie(account.username));
  res.json({ admin: { username: account.username } });
});

app.post("/api/admin/setup", (req, res) => {
  if (isAdminConfigured()) return res.status(409).json({ error: "admin_already_configured" });
  const username = cleanText(req.body?.username);
  const password = String(req.body?.password || "");
  if (!username || !password) return res.status(400).json({ error: "missing_fields" });
  db.prepare(
    "INSERT INTO admin_credentials (id, username, password_hash) VALUES (1, ?, ?)"
  ).run(username, hashPassword(password));
  res.setHeader("Set-Cookie", adminSessionCookie(username));
  res.status(201).json({ admin: { username } });
});

app.post("/api/admin/logout", requireAdmin, (_req, res) => {
  res.setHeader("Set-Cookie", clearAdminSessionCookie());
  res.json({ ok: true });
});

app.get("/api/admin/me", (req, res) => {
  const admin = readAdminSession(req);
  res.json({ admin: admin ? { username: admin.username } : null, configured: isAdminConfigured() });
});

app.get("/api/admin/overview", requireAdmin, (_req, res) => {
  res.json({
    stats: getAdminStats(),
    users: getAdminUsers(),
    invites: getAdminInvites(),
    activity: getAdminActivity()
  });
});

app.post("/api/admin/invites/:token/revoke", requireAdmin, (req, res) => {
  const result = db.prepare("UPDATE event_invites SET revoked_at = CURRENT_TIMESTAMP WHERE token = ? AND revoked_at IS NULL").run(req.params.token);
  res.json({ ok: result.changes > 0, invites: getAdminInvites(), activity: getAdminActivity() });
});

app.get("/api/admin/backup", requireAdmin, (_req, res) => {
  if (!fs.existsSync(config.dbPath)) return res.status(404).json({ error: "backup_not_found" });
  res.download(config.dbPath, `fairpay-backup-${new Date().toISOString().slice(0, 10)}.sqlite`);
});

app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});

app.get("/invite/:token", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : "server_error" });
});

app.listen(config.port, () => {
  console.log(`FAIRPAY is running on http://localhost:${config.port}`);
});

function attachUser(req, _res, next) {
  const cookies = readCookies(req.headers.cookie);
  const sid = cookies.sid;
  if (!sid) return next();

  const session = db
    .prepare(
      `SELECT sessions.id AS session_id, users.*
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ? AND sessions.expires_at > CURRENT_TIMESTAMP`
    )
    .get(sid);
  if (session) {
    req.sessionId = session.session_id;
    req.user = session;
  }
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "auth_required" });
  next();
}

function requireAdmin(req, res, next) {
  const admin = readAdminSession(req);
  if (!admin) return res.status(401).json({ error: "admin_auth_required" });
  req.admin = admin;
  next();
}

function isAdminConfigured() {
  return Boolean(getAdminAccount());
}

function getAdminAccount() {
  return db.prepare("SELECT * FROM admin_credentials WHERE id = 1").get();
}

function adminSessionCookie(username) {
  const expiresAt = Date.now() + ADMIN_SESSION_HOURS * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ username, expiresAt })).toString("base64url");
  const signature = signAdminPayload(payload);
  const parts = [
    `${ADMIN_COOKIE}=${encodeURIComponent(`${payload}.${signature}`)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`
  ];
  if (config.secureCookies) parts.push("Secure");
  return parts.join("; ");
}

function clearAdminSessionCookie() {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function readAdminSession(req) {
  const account = getAdminAccount();
  if (!account) return null;
  const token = readCookies(req.headers.cookie)[ADMIN_COOKIE];
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, signAdminPayload(payload))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (session.username !== account.username || Number(session.expiresAt) < Date.now()) return null;
    return { username: session.username };
  } catch (_error) {
    return null;
  }
}

function signAdminPayload(payload) {
  return crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireEventMember(req, res, next) {
  const event = getEventForUser(req.params.id, req.user.id);
  if (!event) return res.status(404).json({ error: "event_not_found" });
  req.event = event;
  next();
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, phone: user.phone || "", birthDate: user.birth_date || "", avatarUrl: user.avatar_url || "" };
}

function getAdminStats() {
  const dbSize = fs.existsSync(config.dbPath) ? fs.statSync(config.dbPath).size : 0;
  return {
    users: db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
    activeSessions: db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE expires_at > CURRENT_TIMESTAMP").get().count,
    activeInvites: db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM event_invites
         WHERE revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`
      )
      .get().count,
    expenses: db.prepare("SELECT COUNT(*) AS count FROM expenses").get().count,
    openRestaurants: db.prepare("SELECT COUNT(*) AS count FROM restaurant_bills WHERE status = 'open'").get().count,
    dbSize
  };
}

function getAdminUsers() {
  return db
    .prepare(
      `SELECT users.id,
              users.name,
              users.email,
              users.phone,
              users.birth_date AS birthDate,
              users.avatar_url AS avatarUrl,
              users.created_at AS createdAt,
              COUNT(DISTINCT event_members.event_id) AS groupCount,
              COUNT(DISTINCT expenses.id) AS expenseCount
       FROM users
       LEFT JOIN event_members ON event_members.user_id = users.id
       LEFT JOIN expenses ON expenses.created_by = users.id
       GROUP BY users.id
       ORDER BY users.created_at DESC`
    )
    .all();
}

function getAdminInvites() {
  return db
    .prepare(
      `SELECT event_invites.token,
              event_invites.created_at AS createdAt,
              event_invites.expires_at AS expiresAt,
              event_invites.revoked_at AS revokedAt,
              events.name AS eventName,
              users.name AS createdByName,
              users.email AS createdByEmail
       FROM event_invites
       JOIN events ON events.id = event_invites.event_id
       JOIN users ON users.id = event_invites.created_by
       WHERE event_invites.revoked_at IS NULL
         AND (event_invites.expires_at IS NULL OR event_invites.expires_at > CURRENT_TIMESTAMP)
       ORDER BY event_invites.created_at DESC
       LIMIT 50`
    )
    .all()
    .map((invite) => ({ ...invite, inviteUrl: `${config.appUrl}/invite/${invite.token}` }));
}

function getAdminActivity() {
  return db
    .prepare(
      `SELECT 'user_registered' AS type, users.name AS title, users.email AS detail, users.created_at AS createdAt
       FROM users
       UNION ALL
       SELECT 'expense_created' AS type, expenses.title AS title, users.name AS detail, expenses.created_at AS createdAt
       FROM expenses
       JOIN users ON users.id = expenses.created_by
       UNION ALL
       SELECT 'invite_created' AS type, events.name AS title, users.name AS detail, event_invites.created_at AS createdAt
       FROM event_invites
       JOIN events ON events.id = event_invites.event_id
       JOIN users ON users.id = event_invites.created_by
       UNION ALL
       SELECT 'debt_closed' AS type, events.name AS title, users.name AS detail, settlement_payments.created_at AS createdAt
       FROM settlement_payments
       JOIN events ON events.id = settlement_payments.event_id
       JOIN users ON users.id = settlement_payments.created_by
       ORDER BY createdAt DESC
       LIMIT 40`
    )
    .all();
}

function getUser(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function getEventForUser(eventId, userId) {
  return db
    .prepare(
      `SELECT e.*
       FROM events e
       JOIN event_members em ON em.event_id = e.id
       WHERE e.id = ? AND em.user_id = ?`
    )
    .get(eventId, userId);
}

function buildEventPayload(eventId) {
  return {
    event: db.prepare("SELECT * FROM events WHERE id = ?").get(eventId),
    members: getMembers(eventId),
    expenses: getExpenses(eventId),
    restaurantBills: getRestaurantBills(eventId),
    settlement: buildSettlement(eventId)
  };
}

function getMembers(eventId) {
  return db
    .prepare(
      `SELECT users.id, users.name, users.email, users.avatar_url AS avatarUrl, event_members.role, event_members.joined_at
       FROM event_members
       JOIN users ON users.id = event_members.user_id
       WHERE event_members.event_id = ?
       ORDER BY event_members.joined_at ASC`
    )
    .all(eventId);
}

function getMemberPreview(eventId) {
  return db
    .prepare(
      `SELECT users.id, users.name, users.avatar_url AS avatarUrl
       FROM event_members
       JOIN users ON users.id = event_members.user_id
       WHERE event_members.event_id = ?
       ORDER BY event_members.joined_at ASC
       LIMIT 5`
    )
    .all(eventId);
}

function getExpenses(eventId) {
  const expenses = db.prepare("SELECT * FROM expenses WHERE event_id = ? ORDER BY expense_date DESC, id DESC").all(eventId);
  return expenses.map((expense) => ({
    id: expense.id,
    title: expense.title,
    amount: expense.amount_cents / 100,
    amountCents: expense.amount_cents,
    currency: expense.currency,
    exchangeRate: expense.exchange_rate,
    expenseDate: expense.expense_date,
    category: expense.category,
    splitType: expense.split_type,
    createdBy: expense.created_by,
    payers: db.prepare("SELECT user_id AS userId, amount_cents AS amountCents FROM expense_payers WHERE expense_id = ?").all(expense.id),
    participants: db
      .prepare("SELECT user_id AS userId, share_cents AS shareCents FROM expense_participants WHERE expense_id = ?")
      .all(expense.id)
  }));
}

function getRestaurantBills(eventId) {
  return db
    .prepare("SELECT * FROM restaurant_bills WHERE event_id = ? AND status = 'open' ORDER BY created_at DESC")
    .all(eventId)
    .map((bill) => getRestaurantBill(eventId, bill.id));
}

function getOpenRestaurantBill(eventId, billId) {
  return db.prepare("SELECT * FROM restaurant_bills WHERE id = ? AND event_id = ? AND status = 'open'").get(billId, eventId);
}

function getRestaurantBill(eventId, billId) {
  const bill = db.prepare("SELECT * FROM restaurant_bills WHERE id = ? AND event_id = ?").get(billId, eventId);
  if (!bill) return null;
  const items = getRestaurantBillItems(bill.id);
  const sameCurrency = items.every((item) => item.currency === bill.currency);
  const totalCents = sameCurrency ? items.reduce((sum, item) => sum + item.amountCents, 0) : 0;
  return {
    id: bill.id,
    eventId: bill.event_id,
    title: bill.title,
    currency: bill.currency,
    status: bill.status,
    paidBy: bill.paid_by,
    expenseId: bill.expense_id,
    createdBy: bill.created_by,
    createdAt: bill.created_at,
    updatedAt: bill.updated_at,
    paidAt: bill.paid_at,
    total: totalCents / 100,
    totalCents,
    hasMixedCurrencies: !sameCurrency,
    items
  };
}

function getRestaurantBillItems(billId) {
  return db
    .prepare(
      `SELECT restaurant_bill_items.user_id AS userId, users.name, restaurant_bill_items.amount_cents AS amountCents, restaurant_bill_items.updated_at AS updatedAt
              , restaurant_bill_items.currency AS currency
       FROM restaurant_bill_items
       JOIN users ON users.id = restaurant_bill_items.user_id
       WHERE restaurant_bill_items.bill_id = ?
       ORDER BY users.name COLLATE NOCASE`
    )
    .all(billId)
    .map((item) => ({ ...item, amount: item.amountCents / 100 }));
}

function buildSettlement(eventId) {
  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId);
  return calculateSettlement({
    members: getMembers(eventId),
    expenses: getExpenses(eventId),
    settlementPayments: getSettlementPayments(eventId),
    eventCurrency: event.base_currency
  });
}

function getSettlementPayments(eventId) {
  return db
    .prepare(
      `SELECT id, from_user_id AS fromUserId, to_user_id AS toUserId, amount_cents AS amountCents, created_by AS createdBy, created_at AS createdAt
       FROM settlement_payments
       WHERE event_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(eventId)
    .map((payment) => ({ ...payment, amount: payment.amountCents / 100 }));
}

async function getExchangeRate(from, to) {
  if (from === to) return { from, to, rate: 1, source: "same_currency", date: new Date().toISOString().slice(0, 10) };

  try {
    const rates = await getBankOfIsraelRates();
    const fromIls = from === "ILS" ? 1 : rates[from];
    const toIls = to === "ILS" ? 1 : rates[to];
    if (fromIls && toIls) {
      return {
        from,
        to,
        rate: fromIls / toIls,
        source: "bank_of_israel",
        date: rates.date
      };
    }
  } catch (_error) {
    // Fall through to the public fallback below.
  }

  const response = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`);
  if (!response.ok) throw Object.assign(new Error("exchange_rate_unavailable"), { status: 502 });
  const data = await response.json();
  const rate = Number(data?.rates?.[to]);
  if (!rate || data?.result === "error") throw Object.assign(new Error("exchange_rate_unavailable"), { status: 502 });
  return { from, to, rate, source: "open_exchange_rate_fallback", date: data.time_last_update_utc || new Date().toISOString() };
}

async function getBankOfIsraelRates() {
  const response = await fetch("https://boi.org.il/PublicApi/GetExchangeRates", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("bank_of_israel_unavailable");
  const data = await response.json();
  const rates = { date: new Date().toISOString().slice(0, 10) };
  for (const item of data?.exchangeRates || []) {
    const currency = String(item?.key || "").toUpperCase();
    const rate = Number(item?.currentExchangeRate);
    if (currency && rate > 0) rates[currency] = rate;
    if (item?.lastUpdate) rates.date = String(item.lastUpdate).slice(0, 10);
  }
  if (Object.keys(rates).length <= 1) throw new Error("bank_of_israel_empty");
  return rates;
}

async function saveExpense({ eventId, userId, expenseId, input }) {
  const event = db.prepare("SELECT base_currency FROM events WHERE id = ?").get(eventId);
  const title = String(input?.title || "").trim();
  const amountCents = cents(input?.amount || 0);
  const currency = String(input?.currency || "ILS").trim().toUpperCase();
  const baseCurrency = String(event?.base_currency || "ILS").trim().toUpperCase();
  let exchangeRate = Number(input?.exchangeRate || 0);
  const expenseDate = String(input?.expenseDate || new Date().toISOString().slice(0, 10));
  const category = String(input?.category || "other").trim();
  const splitType = input?.splitType === "unequal" ? "unequal" : "equal";
  const payers = normalizeMoneyRows(input?.payers, "userId", "amount");
  const participants = normalizeMoneyRows(input?.participants, "userId", splitType === "equal" ? null : "share");

  if (currency === baseCurrency) {
    exchangeRate = 1;
  } else if (!Number.isFinite(exchangeRate) || exchangeRate <= 0 || exchangeRate === 1) {
    const quote = await getExchangeRate(currency, baseCurrency);
    exchangeRate = quote.rate;
  }

  if (!title || amountCents <= 0 || payers.length === 0 || participants.length === 0) {
    const error = new Error("invalid_expense");
    error.status = 400;
    throw error;
  }

  assertMembers(eventId, [...payers.map((payer) => payer.userId), ...participants.map((participant) => participant.userId)]);

  const payerTotal = payers.reduce((sum, payer) => sum + payer.amountCents, 0);
  if (payerTotal !== amountCents) throw Object.assign(new Error("payer_total_mismatch"), { status: 400 });

  const tx = db.transaction(() => {
    let id = expenseId;
    if (id) {
      db.prepare(
        `UPDATE expenses
         SET title = ?, amount_cents = ?, currency = ?, exchange_rate = ?, expense_date = ?, category = ?, split_type = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND event_id = ?`
      ).run(title, amountCents, currency, exchangeRate, expenseDate, category, splitType, id, eventId);
      db.prepare("DELETE FROM expense_payers WHERE expense_id = ?").run(id);
      db.prepare("DELETE FROM expense_participants WHERE expense_id = ?").run(id);
    } else {
      const result = db
        .prepare(
          `INSERT INTO expenses (event_id, title, amount_cents, currency, exchange_rate, expense_date, category, split_type, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(eventId, title, amountCents, currency, exchangeRate, expenseDate, category, splitType, userId);
      id = result.lastInsertRowid;
    }

    const payerInsert = db.prepare("INSERT INTO expense_payers (expense_id, user_id, amount_cents) VALUES (?, ?, ?)");
    for (const payer of payers) payerInsert.run(id, payer.userId, payer.amountCents);

    const participantInsert = db.prepare("INSERT INTO expense_participants (expense_id, user_id, share_cents) VALUES (?, ?, ?)");
    if (splitType === "equal") {
      for (const participant of participants) participantInsert.run(id, participant.userId, 0);
    } else {
      const shareTotal = participants.reduce((sum, participant) => sum + participant.shareCents, 0);
      if (shareTotal !== amountCents) throw Object.assign(new Error("share_total_mismatch"), { status: 400 });
      for (const participant of participants) participantInsert.run(id, participant.userId, participant.shareCents);
    }

    return getExpenses(eventId).find((expense) => expense.id === id);
  });

  return tx();
}

function normalizeMoneyRows(rows, idKey, amountKey) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      userId: Number(row?.[idKey]),
      amountCents: amountKey ? cents(row?.[amountKey] || 0) : 0,
      shareCents: amountKey ? cents(row?.[amountKey] || 0) : 0
    }))
    .filter((row) => Number.isInteger(row.userId) && row.userId > 0);
}

function assertMembers(eventId, userIds) {
  const uniqueIds = [...new Set(userIds)];
  const members = db
    .prepare(`SELECT user_id FROM event_members WHERE event_id = ? AND user_id IN (${uniqueIds.map(() => "?").join(",")})`)
    .all(eventId, ...uniqueIds);
  if (members.length !== uniqueIds.length) throw Object.assign(new Error("not_event_member"), { status: 403 });
}

function cleanText(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function cleanAvatar(value) {
  const avatar = cleanText(value);
  if (!avatar) return "";
  if (avatar.length > 1_200_000) throw Object.assign(new Error("avatar_too_large"), { status: 400 });
  if (!avatar.startsWith("data:image/")) throw Object.assign(new Error("invalid_avatar"), { status: 400 });
  return avatar;
}

function cleanEmoji(value) {
  const emoji = cleanText(value);
  return emoji ? emoji.slice(0, 8) : "";
}

function normalizeCurrency(value, fallback = "ILS") {
  const currency = String(value || fallback).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : fallback;
}

function inviteExpiresAt(hours = 24) {
  const numericHours = Number(hours || 24);
  const safeHours = Number.isFinite(numericHours) && numericHours > 0 ? Math.min(numericHours, 24 * 30) : 24;
  return new Date(Date.now() + safeHours * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}
