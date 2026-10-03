import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("manifest is installable on iPhone and standalone browsers", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("public/manifest.webmanifest", root), "utf8"),
  );
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));

  await Promise.all([
    access(new URL("public/icon-192.png", root)),
    access(new URL("public/icon-512.png", root)),
    access(new URL("public/apple-touch-icon.png", root)),
  ]);
});

test("service worker precaches the Next.js offline app shell", async () => {
  const worker = await readFile(new URL("public/sw.js", root), "utf8");
  assert.match(worker, /caches\.open/);
  assert.match(worker, /\/_next\\\/static/);
  assert.match(worker, /precacheAppShell/);
  assert.match(worker, /request\.mode === "navigate"/);
  assert.match(worker, /manifest\.webmanifest/);
  assert.match(worker, /apple-touch-icon\.png/);
});

test("mobile shell accounts for the iPhone safe area", async () => {
  const [css, layout, storage, nextConfig, vercelConfig] = await Promise.all([
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("lib/storage.ts", root), "utf8"),
    readFile(new URL("next.config.ts", root), "utf8"),
    readFile(new URL("vercel.json", root), "utf8"),
  ]);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(layout, /viewportFit:\s*"cover"/);
  assert.match(layout, /appleWebApp/);
  assert.match(storage, /indexedDB\.open/);
  assert.match(storage, /dictionaryCache/);
  assert.match(storage, /savedWords/);
  assert.match(storage, /navigator\.storage\.persist/);
  assert.match(nextConfig, /Service-Worker-Allowed/);
  assert.match(nextConfig, /max-age=0, must-revalidate/);
  assert.equal(JSON.parse(vercelConfig).framework, "nextjs");
});

