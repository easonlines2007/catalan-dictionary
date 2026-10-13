import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { SearchRepository } from "../lib/search-repository.ts";
import { getDictionaryMetadata } from "../lib/storage.ts";
import type { SearchManifest } from "../lib/types.ts";

const publicRoot = resolve(import.meta.dirname, "../public");
const manifest = JSON.parse(await readFile(resolve(publicRoot, "dictionary/search/manifest.json"), "utf8")) as SearchManifest;
const retired = JSON.parse(JSON.stringify(manifest).replaceAll(manifest.dataVersion, "retired-version")) as SearchManifest;

test("long-lived tabs recover concurrent lookups, Chinese overlays and suggestions after a deployment", async () => {
  const previousFetch = globalThis.fetch;
  let manifests = 0;
  globalThis.fetch = async (input) => {
    const path = String(input);
    if (path === "/dictionary/search/manifest.json") return Response.json(++manifests === 1 ? retired : manifest);
    if (path.includes("retired-version")) return new Response(null, { status: 410 });
    const file = resolve(publicRoot, path.replace(/^\/+/, ""));
    assert.ok(file.startsWith(publicRoot + sep));
    return new Response(await readFile(file));
  };
  try {
    const repository = new SearchRepository();
    await repository.manifest(manifest.baseDataVersion);
    const [reverse, core, chinese, suggestions] = await Promise.all([
      repository.reverse("学校", "zh", manifest.baseDataVersion),
      repository.coreEntry("escola", manifest.baseDataVersion),
      repository.chineseEntry("ara", manifest.baseDataVersion),
      repository.suggest("音悦", "zh", manifest.baseDataVersion),
      repository.ensureCoreOffline(manifest.baseDataVersion),
    ]);
    assert.equal(reverse[0]?.normalizedLemma, "escola");
    assert.equal(core?.n, "escola");
    assert.ok(chinese?.zh?.some((text) => text.includes("现在")));
    assert.equal(suggestions[0]?.lemma, "música");
    assert.equal(manifests, 2, "Concurrent failures must share a single manifest refresh");
    assert.equal(await getDictionaryMetadata(`searchCoreReady:${manifest.dataVersion}`), true);
    assert.equal(await getDictionaryMetadata(`searchCoreReady:${retired.dataVersion}`), undefined);
  } finally { globalThis.fetch = previousFetch; }
});

test("a missing shard with an unchanged manifest retries metadata only once", async () => {
  const previousFetch = globalThis.fetch;
  let manifests = 0, packs = 0;
  globalThis.fetch = async (input) => {
    if (String(input) === "/dictionary/search/manifest.json") { manifests++; return Response.json(retired); }
    packs++; return new Response(null, { status: 404 });
  };
  try {
    await assert.rejects(new SearchRepository().reverse("学校", "zh", manifest.baseDataVersion), /retired/);
    assert.equal(manifests, 2);
    assert.equal(packs, 1);
  } finally { globalThis.fetch = previousFetch; }
});

test("temporary server errors do not trigger deployment refreshes", async () => {
  const previousFetch = globalThis.fetch;
  let manifests = 0;
  globalThis.fetch = async (input) => {
    if (String(input) === "/dictionary/search/manifest.json") { manifests++; return Response.json(retired); }
    return new Response(null, { status: 503 });
  };
  try {
    await assert.rejects(new SearchRepository().reverse("学校", "zh", manifest.baseDataVersion), /HTTP 503/);
    assert.equal(manifests, 1);
  } finally { globalThis.fetch = previousFetch; }
});

test("offline misses do not repeatedly request newer manifests", async () => {
  const previousFetch = globalThis.fetch;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let manifests = 0;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  globalThis.fetch = async (input) => {
    if (String(input) === "/dictionary/search/manifest.json") { manifests++; return Response.json(retired); }
    return new Response(null, { status: 404 });
  };
  try {
    await assert.rejects(new SearchRepository().reverse("学校", "zh", manifest.baseDataVersion), /retired/);
    assert.equal(manifests, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
