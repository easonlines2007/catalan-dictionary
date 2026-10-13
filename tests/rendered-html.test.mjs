import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Next.js production build emits the dictionary route", async () => {
  await Promise.all([
    access(new URL(".next/BUILD_ID", root)),
    access(new URL(".next/server/app/page.js", root)),
    access(new URL(".next/app-path-routes-manifest.json", root)),
  ]);

  const manifest = JSON.parse(
    await readFile(new URL(".next/app-path-routes-manifest.json", root), "utf8"),
  );
  assert.equal(manifest["/page"], "/");
});

test("app shell keeps install metadata and accessible search copy", async () => {
  const [layout, app] = await Promise.all([
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/dictionary-app.tsx", root), "utf8"),
  ]);

  assert.match(layout, /Català — Diccionari de butxaca/);
  assert.match(layout, /manifest\.webmanifest/);
  assert.match(layout, /apple-touch-icon\.png/);
  assert.match(app, /输入中文、西班牙语或加泰语，查找 Català 单词/);
  assert.match(app, /aria-label="输入语言"/);
  assert.doesNotMatch(app, /codex-preview|react-loading-skeleton/i);
});

