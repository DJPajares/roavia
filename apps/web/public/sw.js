const shellCache = "roavia-shell-v2";
const runtimeCache = "roavia-runtime-v2";
const knownCaches = new Set([shellCache, runtimeCache]);

async function cacheRouteAndAssets(cache, route) {
  const response = await fetch(route, { credentials: "include" });
  if (!response.ok || response.redirected) return;
  await cache.put(route, response.clone());
  if (!response.headers.get("content-type")?.includes("text/html")) return;

  const html = await response.text();
  const assetUrls = new Set(
    [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
      .map((match) => new URL(match[1], self.location.origin))
      .filter(
        (url) => url.origin === self.location.origin && url.pathname.startsWith("/_next/static/"),
      )
      .map((url) => url.href),
  );

  for (const assetUrl of assetUrls) {
    const asset = await fetch(assetUrl);
    if (asset.ok) await cache.put(assetUrl, asset);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(shellCache)
      .then((cache) =>
        cache.addAll(["/", "/icon.svg", "/manifest.webmanifest", "/pwa-icon-192", "/pwa-icon-512"]),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !knownCaches.has(key)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_OFFLINE_ROUTES" || !Array.isArray(event.data.routes)) return;
  const routes = event.data.routes.filter(
    (route) => typeof route === "string" && route.startsWith("/") && !route.startsWith("//"),
  );
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(runtimeCache);
        for (const route of routes) {
          try {
            await cacheRouteAndAssets(cache, route);
          } catch {
            // The package is already safe in IndexedDB; route caching can retry on the next refresh.
          }
        }
      } finally {
        event.ports[0]?.postMessage({ type: "OFFLINE_ROUTES_CACHED" });
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached && self.navigator.onLine === false) return cached;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3_000);
        try {
          return await fetch(request, { signal: controller.signal });
        } catch {
          if (cached) return cached;
          const offlineLibrary = await caches.match("/offline");
          if (offlineLibrary) return offlineLibrary;
          return (await caches.match("/")) ?? Response.error();
        } finally {
          clearTimeout(timeout);
        }
      })(),
    );
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/pwa-icon-")
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              void caches.open(runtimeCache).then((cache) => cache.put(request, response.clone()));
            }
            return response;
          }),
      ),
    );
  }
});
