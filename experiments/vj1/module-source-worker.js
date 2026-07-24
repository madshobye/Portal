const SOURCE_SUFFIXES = Object.freeze([
  ".js",
  ".mjs",
  ".json",
  ".css",
  ".html",
  ".frag",
  ".vert",
  ".glsl",
]);

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  const sourceRequest = request.mode === "navigate"
    || SOURCE_SUFFIXES.some((suffix) => url.pathname.endsWith(suffix));
  if (!sourceRequest) return;

  // Native ES-module URLs form a dependency graph, but HTTP caches know only
  // individual files. Do not read or populate the HTTP cache for source
  // artifacts: conditional revalidation may still preserve an obsolete module
  // when a development server returns stale validators.
  event.respondWith(fetch(request, { cache: "no-store" }));
});
