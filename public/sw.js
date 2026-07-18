const CACHE_NAME = "fairpay-shell-v169";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css?v=167",
  "/app.js?v=167",
  "/admin.html",
  "/admin.css?v=7",
  "/admin.js?v=7",
  "/manifest.json?v=157",
  "/APP-icon.png?v=157",
  "/icon-512.png?v=157",
  "/icon-192.png?v=157",
  "/apple-touch-icon.png?v=157",
  "/favicon.ico?v=157",
  "/manifest.json",
  "/APP-icon.png",
  "/icon-512.png",
  "/icon-192.png",
  "/apple-touch-icon.png",
  "/favicon.ico"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request).catch(() => new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    })));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/index.html")));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
