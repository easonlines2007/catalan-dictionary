const APP_SHELL_CACHE = "catala-pocket-shell-v17";
const DICTIONARY_BOOTSTRAP_CACHE = "catala-pocket-dictionary-bootstrap-v4";
const CORE_ASSETS = [
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/dictionary/manifest.json",
  "/dictionary/notices.json",
  "/dictionary/search/manifest.json",
  "/dictionary/search/pinyin-license.txt",
];

async function precacheAppShell() {
  const cache = await caches.open(APP_SHELL_CACHE);
  await cache.addAll(CORE_ASSETS.slice(0, 4));

  const response = await fetch("/", { cache: "reload" });
  if (!response.ok) throw new Error("Could not fetch the app shell");
  await cache.put("/", response.clone());

  const html = await response.text();
  const nextAssets = new Set(
    [...html.matchAll(/(?:src|href)=["'](\/_next\/static\/[^"']+)["']/g)].map(
      (match) => match[1],
    ),
  );
  await Promise.all([...nextAssets].map((asset) => cache.add(asset)));
}

async function precacheDictionaryBootstrap() {
  const cache = await caches.open(DICTIONARY_BOOTSTRAP_CACHE);
  const [manifestResponse, searchResponse] = await Promise.all([
    fetch("/dictionary/manifest.json", { cache: "reload" }),
    fetch("/dictionary/search/manifest.json", { cache: "reload" }),
  ]);
  if (!manifestResponse.ok || !searchResponse.ok) {
    throw new Error("Could not fetch dictionary manifests");
  }
  const [manifest, search] = await Promise.all([
    manifestResponse.clone().json(),
    searchResponse.clone().json(),
  ]);
  if (search.schemaVersion !== 1 || search.baseDataVersion !== manifest.dataVersion) {
    throw new Error("Dictionary search data does not match the base dictionary");
  }
  const coreAssets = [
    manifest.coreDescriptors?.lex?.path || manifest.core?.lex?.path || manifest.core?.lex,
    manifest.coreDescriptors?.morph?.path || manifest.core?.morph?.path || manifest.core?.morph,
    search.core?.entries?.path,
    search.core?.zh?.path,
    search.core?.es?.path,
    search.licensing?.openccLicense,
    "/dictionary/search/pinyin-license.txt",
    ...(search.licensing?.wordnetLicenses || []),
  ].filter(Boolean);
  const keep = new Set([
    "/dictionary/manifest.json",
    "/dictionary/notices.json",
    "/dictionary/search/manifest.json",
    ...coreAssets,
  ]);
  await Promise.all([
    cache.add("/dictionary/notices.json"),
    ...coreAssets.map((asset) => cache.add(asset)),
  ]);
  // Publish manifest snapshots only after all of their bootstrap assets exist.
  await Promise.all([
    cache.put("/dictionary/manifest.json", manifestResponse),
    cache.put("/dictionary/search/manifest.json", searchResponse),
  ]);
  const existing = await cache.keys();
  await Promise.all(
    existing
      .filter((request) => !keep.has(new URL(request.url).pathname))
      .map((request) => cache.delete(request)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([precacheAppShell(), precacheDictionaryBootstrap()]),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (key) =>
              (key.startsWith("catala-pocket-shell-") && key !== APP_SHELL_CACHE) ||
              (key.startsWith("catala-pocket-dictionary-bootstrap-") &&
                key !== DICTIONARY_BOOTSTRAP_CACHE),
          )
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(APP_SHELL_CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(async () =>
          (await caches.match(request)) || (await caches.match("/")),
        ),
    );
    return;
  }

  if (
    url.pathname === "/dictionary/manifest.json" ||
    url.pathname === "/dictionary/search/manifest.json" ||
    url.pathname === "/dictionary/notices.json"
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(DICTIONARY_BOOTSTRAP_CACHE)
              .then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // Extended dictionary shards are deliberately owned only by IndexedDB.
  // Avoid a second unbounded CacheStorage copy on iPhone.
  if (url.pathname.startsWith("/dictionary/")) {
    event.respondWith(
      caches
        .open(DICTIONARY_BOOTSTRAP_CACHE)
        .then((cache) => cache.match(request))
        .then((cached) => cached || fetch(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && url.pathname.startsWith("/_next/static/")) {
          const copy = response.clone();
          caches
            .open(APP_SHELL_CACHE)
            .then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

