export function getConfig() {
  const appUrl = normalizeAppUrl(process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`);
  const parsedUrl = new URL(appUrl);

  return {
    appUrl,
    secureCookies: parsedUrl.protocol === "https:",
    port: Number(process.env.PORT || 3000),
    dbPath: process.env.DB_PATH || "./data/fairpay.sqlite",
    sessionSecret: process.env.SESSION_SECRET || "dev-only-session-secret-change-me",
    trustProxy: String(process.env.TRUST_PROXY || "false").toLowerCase() === "true"
  };
}

export function normalizeAppUrl(value) {
  const cleaned = String(value || "").trim().replace(/\/+$/, "");
  return cleaned.replace(/^https?:\/\/(https?:\/\/)/i, "$1");
}
