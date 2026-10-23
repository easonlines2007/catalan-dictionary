import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { lookupWord, suggestWords } from "../lib/lookup.ts";
import { dictionaryRepository } from "../lib/dictionary-repository.ts";
import type { SearchManifest } from "../lib/types.ts";

interface Case { query: string; expectedLemma: string }
const publicRoot = resolve(import.meta.dirname, "../public");
const fixture = JSON.parse(await readFile(new URL("../data/search/chinese-single-word-cases.json", import.meta.url), "utf8")) as {
  baseDataVersion: string;
  cases: Case[];
  contrasts: Array<{ query: string; excludedLemma: string }>;
  unmatched: string[];
  preserved: Case[];
};

test("correctly spelled single-word synonyms select source-backed words online and from installed core", async (t) => {
  const previousFetch = globalThis.fetch;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let offline = false;
  globalThis.fetch = async (input) => {
    assert.equal(offline, false, "Installed core synonym search must not fetch any asset");
    const path = resolve(publicRoot, new URL(String(input), "https://synonyms.invalid").pathname.replace(/^\/+/, ""));
    assert.ok(path.startsWith(publicRoot + sep));
    return new Response(await readFile(path));
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { get onLine() { return !offline; } } });
  try {
    const manifest = JSON.parse(await readFile(resolve(publicRoot, "dictionary/search/manifest.json"), "utf8")) as SearchManifest;
    assert.equal(fixture.baseDataVersion, manifest.baseDataVersion);
    assert.ok(fixture.cases.length >= 250);
    assert.equal(new Set(fixture.cases.map(item => item.query)).size, fixture.cases.length);
    const core = JSON.parse(gunzipSync(await readFile(resolve(publicRoot, manifest.core.entries.path.slice(1)))).toString()) as Array<{ n: string }>;
    const coreLemmas = new Set(core.map(row => row.n));
    await dictionaryRepository.ensureCoreOffline();

    await t.test("core synonyms work before any online lookup warms the full indexes", async () => {
      offline = true;
      const cases = fixture.cases.filter(item => coreLemmas.has(item.expectedLemma));
      assert.ok(cases.length > 100);
      for (const { query, expectedLemma } of cases) {
        const found = await lookupWord(query, "zh");
        assert.equal(found.status, "found", query);
        if (found.status === "found") assert.equal(found.entry.normalizedLemma, expectedLemma, query);
      }
      for (const query of ["电话机", "订座", "医师", "衣物", "查找"]) {
        const item = cases.find(item => item.query === query);
        assert.ok(item, `Expected core synonym: ${query}`);
        assert.equal((await suggestWords(query, "zh"))[0]?.lemma, item.expectedLemma, query);
      }
      offline = false;
    });

    await t.test("every synonym works with Enter, automatic detection and exact suggestion selection", async () => {
      for (const { query, expectedLemma } of fixture.cases) {
        for (const mode of ["zh", "auto"] as const) {
          const found = await lookupWord(query, mode);
          assert.equal(found.status, "found", `${mode}: ${query}`);
          if (found.status === "found") {
            assert.equal(found.entry.normalizedLemma, expectedLemma, `${mode}: ${query}`);
            assert.equal(found.matchedLanguage, "zh");
            assert.equal(found.extractedQuery, undefined, "A vocabulary word is not a sentence prompt");
          }
        }
        const hint = (await suggestWords(query, "zh"))[0];
        assert.equal(hint?.lemma, expectedLemma, `suggestion: ${query}`);
        assert.equal(hint?.kind, "exact", `A synonym is not a spelling correction: ${query}`);
        const selected = await lookupWord(hint.term, hint.language);
        assert.equal(selected.status, "found", query);
        if (selected.status === "found") assert.equal(selected.entry.normalizedLemma, expectedLemma, query);
      }
    });

    await t.test("traditional synonyms share the same targets and direction and negation stay distinct", async () => {
      for (const [query, lemma] of [["電話機", "telèfon"], ["購置", "comprar"], ["醫師", "metge"],
        ["藥鋪", "farmàcia"], ["廉價", "barat"], ["勤奮", "treballador"], ["訂座", "reservar"]]) {
        const found = await lookupWord(query, "auto");
        assert.equal(found.status, "found", query);
        if (found.status === "found") assert.equal(found.entry.normalizedLemma, lemma, query);
        assert.equal((await suggestWords(query, "zh"))[0]?.lemma, lemma, query);
      }
      for (const { query, excludedLemma } of fixture.contrasts) {
        const found = await lookupWord(query, "zh");
        assert.equal(found.status, "found", query);
        if (found.status === "found") assert.ok(found.candidates.every(item => item.entry?.normalizedLemma !== excludedLemma), query);
      }
      for (const [query, alternative] of [["旅店", "hostal"], ["医师", "facultatiu"], ["搜寻", "buscar"]]) {
        const found = await lookupWord(query, "zh");
        assert.equal(found.status, "found", query);
        if (found.status === "found") assert.ok(found.candidates.some(item => item.entry?.normalizedLemma === alternative),
          `Keep other established translations: ${query}`);
      }
      for (const query of fixture.unmatched) assert.equal((await lookupWord(query, "zh")).status, "not-found", query);
      for (const { query, expectedLemma } of fixture.preserved) {
        const found = await lookupWord(query, "zh");
        assert.equal(found.status, "found", query);
        if (found.status === "found") assert.equal(found.entry.normalizedLemma, expectedLemma, query);
      }
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
