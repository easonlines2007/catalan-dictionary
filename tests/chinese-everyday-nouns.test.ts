import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { lookupWord, suggestWords } from "../lib/lookup.ts";
import { dictionaryRepository } from "../lib/dictionary-repository.ts";
import type { SearchManifest } from "../lib/types.ts";

interface Case { query: string; expectedLemma: string; expectedPrimary?: string }
const publicRoot = resolve(import.meta.dirname, "../public");
const fixture = JSON.parse(await readFile(new URL("../data/search/chinese-everyday-noun-cases.json", import.meta.url), "utf8")) as {
  baseDataVersion: string;
  cases: Case[];
  contrasts: Array<{ query: string; excludedLemma: string; excludeCandidate?: boolean }>;
  unmatched: string[];
};

for (const name of ["everyday-verb", "relevance", "precision", "adjective", "boundary", "time-position", "time-adverb", "adverb", "pronoun-question"]) {
  const additional = JSON.parse(await readFile(new URL(`../data/search/chinese-${name}-cases.json`, import.meta.url), "utf8")) as typeof fixture;
  assert.equal(additional.baseDataVersion, fixture.baseDataVersion);
  fixture.cases.push(...additional.cases);
  fixture.contrasts.push(...additional.contrasts);
  fixture.unmatched.push(...additional.unmatched);
}

test("single-word synonyms retain common senses, alternative readings and offline coverage", async (t) => {
  const previousFetch = globalThis.fetch;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let offline = false;
  globalThis.fetch = async (input) => {
    assert.equal(offline, false, "Installed core must not make a network request");
    const path = resolve(publicRoot, new URL(String(input), "https://nouns.invalid").pathname.replace(/^\/+/, ""));
    assert.ok(path.startsWith(publicRoot + sep));
    return new Response(await readFile(path));
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { get onLine() { return !offline; } } });
  try {
    const manifest = JSON.parse(await readFile(resolve(publicRoot, "dictionary/search/manifest.json"), "utf8")) as SearchManifest;
    assert.equal(fixture.baseDataVersion, manifest.baseDataVersion);
    assert.ok(fixture.cases.length >= 500);
    const core = JSON.parse(gunzipSync(await readFile(resolve(publicRoot, manifest.core.entries.path.slice(1)))).toString()) as Array<{ n: string }>;
    const coreLemmas = new Set(core.map(row => row.n));
    await dictionaryRepository.ensureCoreOffline();

    await t.test("core alternatives are available before warming online ranges", async () => {
      offline = true;
      try {
        const cases = fixture.cases.filter(item => coreLemmas.has(item.expectedLemma));
        assert.ok(cases.length >= 250);
        for (const { query, expectedLemma, expectedPrimary } of cases) {
          const found = await lookupWord(query, "zh");
          assert.equal(found.status, "found", query);
          if (found.status !== "found") continue;
          assert.ok(found.candidates.some(item => item.entry?.normalizedLemma === expectedLemma), query);
          if (expectedPrimary && coreLemmas.has(expectedPrimary)) assert.equal(found.entry.normalizedLemma, expectedPrimary, query);
        }
      } finally {
        offline = false;
      }
    });

    await t.test("Chinese and automatic exact lookup and completion retain the expected senses", async () => {
      for (const { query, expectedLemma, expectedPrimary } of fixture.cases) {
        for (const mode of ["zh", "auto"] as const) {
          const found = await lookupWord(query, mode);
          assert.equal(found.status, "found", `${mode}: ${query}`);
          if (found.status !== "found") continue;
          assert.ok(found.candidates.some(item => item.entry?.normalizedLemma === expectedLemma), `${mode}: ${query}`);
          if (expectedPrimary) assert.equal(found.entry.normalizedLemma, expectedPrimary, `${mode}: ${query}`);
          assert.equal(found.extractedQuery, undefined, query);
        }
        const hint = (await suggestWords(query, "zh"))[0];
        assert.equal(hint?.kind, "exact", query);
        if (expectedPrimary) assert.equal(hint?.lemma, expectedPrimary, `suggestion: ${query}`);
        const selected = await lookupWord(hint.term, hint.language);
        assert.equal(selected.status, "found", query);
        if (selected.status === "found") assert.ok(selected.candidates.some(item => item.entry?.normalizedLemma === expectedLemma), `selection: ${query}`);
      }
    });

    await t.test("regional terms, traditional spellings and mixed-script words keep their lexical meaning", async () => {
      for (const [query, lemma] of [["滑鼠", "ratolí"], ["印表機", "impressora"], ["資料夾", "carpeta"],
        ["洗髮精", "xampú"], ["計程車", "taxi"], ["馬鈴薯", "patata"], ["高麗菜", "col"],
        ["電子計算機", "ordinador"], ["Ｔ恤", "samarreta"], ["t恤", "samarreta"], ["詞典", "diccionari"],
        ["乾燥", "sec"], ["潮濕", "humit"], ["潤濕", "humitejar"], ["潔淨", "net"],
        ["寬闊", "ample"], ["罕見", "rar"], ["謹慎", "prudent"], ["誠懇", "sincer"],
        ["剛剛", "ara mateix"], ["同時", "alhora"], ["隨即", "tot seguit"],
        ["從此", "des de llavors"], ["每週", "setmanalment"],
        ["偶爾", "ocasionalment"], ["無意中", "accidentalment"], ["故意", "expressament"],
        ["漸漸", "gradualment"], ["隨機", "aleatòriament"], ["自動", "automàticament"],
        ["為什麼", "per què"], ["為啥", "per què"], ["怎麼", "com"],
        ["幾時", "quan"], ["哪兒", "on"], ["我們", "nosaltres"], ["她們", "elles"]]) {
        const found = await lookupWord(query, "auto");
        assert.equal(found.status, "found", query);
        if (found.status === "found") assert.equal(found.entry.normalizedLemma, lemma, query);
      }
      for (const [query, primary, alternative] of [["回答", "respondre", "resposta"], ["预约", "reservar", "cita"],
        ["帮助", "ajudar", "ajuda"], ["健康", "sa", "salut"], ["手机", "telèfon mòbil", "mòbil"]]) {
        const found = await lookupWord(query, "zh");
        assert.equal(found.status, "found", query);
        if (found.status === "found") {
          assert.equal(found.entry.normalizedLemma, primary, query);
          assert.ok(found.candidates.some(item => item.entry?.normalizedLemma === alternative), query);
        }
      }
      for (const { query, excludedLemma, excludeCandidate } of fixture.contrasts) {
        const found = await lookupWord(query, "zh");
        assert.equal(found.status, "found", query);
        if (found.status === "found") {
          assert.notEqual(found.entry.normalizedLemma, excludedLemma, query);
          if (excludeCandidate) assert.ok(found.candidates.every(candidate => candidate.entry?.normalizedLemma !== excludedLemma), query);
        }
      }
      for (const query of fixture.unmatched) assert.equal((await lookupWord(query, "zh")).status, "not-found", query);
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
