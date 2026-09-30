/**
 * Source for `public/sw.js`. `scripts/stamp-sw.mjs` copies this file with the
 * build-id placeholder below resolved to a real id, and the `dev` and `build`
 * scripts run that first, so `public/sw.js` is generated rather than edited
 * directly.
 *
 * The build id does two jobs. It is the suffix on both cache names, so
 * activating a worker drops the previous deploy's caches instead of letting
 * them grow forever. And because the file's bytes change with it, every deploy
 * ships a script the browser can tell apart from the one it is running, which
 * is what actually triggers an install on already-installed devices.
 *
 * There is deliberately no `skipWaiting()` in `install`. A new worker parks in
 * `waiting` and the page decides when to hand over, because `activate` deletes
 * the old chunk cache and a page that is still running the previous build would
 * start 404ing on its own assets mid-session. The page side of that handshake
 * lives in `src/lib/client/appUpdate.ts`: it takes over silently while the app
 * is backgrounded and asks the user while they are in the middle of something.
 */
const VERSION = "BUILD_ID_PLACEHOLDER";
const STATIC_CACHE = `dbw-static-${VERSION}`;
const PAGES_CACHE = `dbw-pages-${VERSION}`;
const OFFLINE_URL = "/offline";

const PRECACHE = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
  OFFLINE_URL,
];

const NEVER_CACHE = ["/api/", "/_next/webpack-hmr", "/_next/static/webpack", "__nextjs"];

/**
 * Adds entries one at a time on purpose. cache.addAll is atomic: a single 404
 * rejects the whole promise, and the old catch swallowed that, so deleting one
 * icon would have left the app with no offline shell and no error to show for
 * it. allSettled keeps whatever did succeed.
 */
function precacheIndividually(cache, urls) {
  return Promise.allSettled(urls.map((url) => cache.add(url)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => precacheIndividually(cache, PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== PAGES_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  // Accepts both the bare string this used to take and a tagged object, so a
  // stale tab that still posts the old shape cannot get stuck.
  const type = typeof event.data === "string" ? event.data : event.data?.type;
  if (type === "SKIP_WAITING") self.skipWaiting();
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname === OFFLINE_URL ||
    url.pathname === "/manifest.webmanifest"
  );
}

/**
 * Next.js serves every `force-dynamic` route with `private, no-cache, no-store`.
 * Storing those would replay a stale document shell on the next offline visit,
 * so they are passed straight through instead.
 */
function isUncacheable(response) {
  const control = response.headers.get("cache-control") ?? "";
  return /no-store|no-cache|private/i.test(control);
}

async function networkFirst(request) {
  const cache = await caches.open(PAGES_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && !isUncacheable(response)) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((prefix) => url.pathname.includes(prefix))) return;
  if (request.headers.get("accept")?.includes("text/event-stream")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});
