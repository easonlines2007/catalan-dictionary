import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { dirname, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import reviewed from "../data/translations/batches/zh-pilot-0001.reviewed.json" with { type: "json" };
import { enrichChinese } from "../lib/chinese-enrichment.ts";
import { DictionaryRepository } from "../lib/dictionary-repository.ts";
import type { DictionaryEntry } from "../lib/types.ts";

const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../public");

function localFetch(coreOnly = false) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const url = new URL(raw, "https://dictionary.test.invalid");
    assert.equal(url.origin, "https://dictionary.test.invalid");
    if (coreOnly) {
      assert.ok(url.pathname.endsWith("/manifest.json") || url.pathname.includes("/core/"),
        `Compact offline lookup tried to fetch an extended shard: ${url.pathname}`);
    }
    const path = resolve(publicRoot, url.pathname.replace(/^\/+/, ""));
    assert.ok(path.startsWith(`${publicRoot}${sep}`));
    try {
      return new Response(await readFile(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response(null, { status: 404 });
      throw error;
    }
  };
}

test("all 25 source-compared entries reach real dictionary lookups", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = localFetch();
  try {
    const repository = new DictionaryRepository();
    for (const record of reviewed.records) {
      const entry = await repository.getEntry(record.normalizedLemma);
      assert.ok(entry, `Missing entry: ${record.lemma}`);
      assert.deepEqual(entry.chinese, record.senses.map((sense) => sense.translationZh));
      assert.ok(entry.provenance?.some((item) => item.sourceEntryId === record.id));
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("compact offline lookup includes Chinese without fetching enrichment shards", async () => {
  const previousFetch = globalThis.fetch;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
  globalThis.fetch = localFetch(true);
  try {
    const manifest = JSON.parse(await readFile(resolve(publicRoot, "dictionary/manifest.json"), "utf8"));
    const coreRows = JSON.parse(gunzipSync(await readFile(
      resolve(publicRoot, manifest.core.lex.replace(/^\/+/, "")),
    )).toString()) as Array<{ n: string }>;
    const coreLemmas = new Set(coreRows.map((row) => row.n));
    const repository = new DictionaryRepository();
    let covered = 0;
    for (const record of reviewed.records) {
      const entry = await repository.getEntry(record.normalizedLemma);
      if (coreLemmas.has(record.normalizedLemma)) {
        covered += 1;
        assert.deepEqual(entry?.chinese, record.senses.map((sense) => sense.translationZh));
      } else {
        // The pilot adds translations, not new core coverage. Unavailable
        // extended entries must not be fabricated from a translation alone.
        assert.equal(entry, undefined, record.lemma);
      }
    }
    assert.equal(covered, 14);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("old saved or cached entries can receive enrichment without mutation", () => {
  const old: DictionaryEntry = {
    lemma: "ciutat",
    normalizedLemma: "ciutat",
    spanish: ["ciudad"],
    source: ["freedict-cat-spa"],
  };
  const result = enrichChinese(old);
  assert.deepEqual(result.chinese, ["城市；都市"]);
  assert.equal(old.chinese, undefined);
  assert.deepEqual(result.spanish, old.spanish);
  assert.ok(result.source?.includes("freedict-cat-spa"));
  assert.strictEqual(enrichChinese(result), result);
});

test("new sharded translations refresh saved snapshots without changing authored Chinese", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = localFetch();
  try {
    const repository = new DictionaryRepository();
    const snapshot: DictionaryEntry = { lemma: "roca", normalizedLemma: "roca", spanish: ["roca"] };
    const refreshed = await repository.enrichEntryChinese(snapshot);
    assert.deepEqual(refreshed.chinese, ["大块岩石（与较小的石块相对）"]);
    assert.equal(snapshot.chinese, undefined);
    assert.deepEqual(refreshed.spanish, snapshot.spanish);
    const authored: DictionaryEntry = { ...snapshot, chinese: ["原有中文"] };
    assert.strictEqual(await repository.enrichEntryChinese(authored), authored);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("authored Chinese and unrelated entries are preserved", () => {
  for (const existing of [
    { chinese: ["已有人工释义"] },
    { definitions: { zh: ["已有词典释义"] } },
  ]) {
    const entry: DictionaryEntry = { lemma: "ciutat", normalizedLemma: "ciutat", ...existing };
    assert.strictEqual(enrichChinese(entry), entry);
  }
  const missing: DictionaryEntry = { lemma: "unknown", normalizedLemma: "unknown" };
  assert.strictEqual(enrichChinese(missing), missing);
});
