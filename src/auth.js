import crypto from "node:crypto";

const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 310000, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$310000$${salt}$${hash}`;
}

export function verifyPassword(password, storedHash) {
  const [scheme, iterations, salt, expected] = storedHash.split("$");
  if (scheme !== "pbkdf2_sha256" || !iterations || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(password, salt, Number(iterations), 32, "sha256");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), actual);
}

export function createSession(db, userId) {
  const id = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(id, userId, expires);
  return { id, expires };
}

export function readCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

export function sessionCookie(session, secure) {
  const parts = [
    `sid=${encodeURIComponent(session.id)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${new Date(session.expires).toUTCString()}`
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie() {
  return "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}
