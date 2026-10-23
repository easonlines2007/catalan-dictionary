import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { lookupWord, normalizeCatalanInput, suggestWords } from "../lib/lookup.ts";
import type { SuggestionRow } from "../lib/search-suggestions.ts";
import { dictionaryRepository } from "../lib/dictionary-repository.ts";
import { SearchRepository } from "../lib/search-repository.ts";
import { normalizeSearchKey, searchCacheKey } from "../lib/search-normalization.ts";
import { primaryChinese } from "../lib/types.ts";
import type { SearchManifest } from "../lib/types.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(root, "public");

test("trilingual lookup resolves real static dictionary assets online and in core offline mode", async (t) => {
  const previousFetch = globalThis.fetch;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const requested: string[] = [];
  let coreOnly = false;
  // Node isolates test files in separate processes. This fixture is additionally
  // restored in finally; subtests run sequentially and never replace singletons.
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const url = new URL(raw, "https://reverse.test.invalid");
    assert.equal(url.origin, "https://reverse.test.invalid");
    requested.push(url.pathname);
    if (coreOnly) {
      assert.ok(url.pathname.endsWith("/manifest.json") || url.pathname.includes("/core/"),
        `Core offline lookup attempted an extended download: ${url.pathname}`);
    }
    const path = resolve(publicRoot, decodeURIComponent(url.pathname).replace(/^\/+/, ""));
    assert.ok(path.startsWith(`${publicRoot}${sep}`), "Fetch escaped the public directory");
    try {
      return new Response(await readFile(path), {
        headers: { "content-type": url.pathname.endsWith(".json") ? "application/json" : "application/gzip" },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response(null, { status: 404 });
      throw error;
    }
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  try {
    await t.test("source-compared descriptive Chinese inputs find their concepts and retain negative meanings", async () => {
      const fixture = JSON.parse(await readFile(resolve(root, "data/search/chinese-semantic-cases.json"), "utf8"));
      assert.ok(fixture.cases.length >= 200);
      for (const { query, expectedLemma } of fixture.cases) {
        for (const mode of ["zh", "auto"] as const) {
          const found = await lookupWord(query, mode);
          assert.equal(found.status, "found", `${mode}: ${query}`);
          if (found.status === "found") assert.ok(found.candidates.some((candidate) => candidate.entry?.normalizedLemma === expectedLemma), `${mode}: ${query}`);
        }
        assert.ok((await suggestWords(query, "zh")).some((item) => item.lemma === expectedLemma), `completion: ${query}`);
      }
      const repository = new SearchRepository();
      const base = await dictionaryRepository.manifest();
      for (const { query, excludedLemma } of fixture.contrasts) {
        const hits = await repository.semantic(query, base.dataVersion);
        assert.ok(hits.length, query);
        assert.ok(hits.every((hit) => hit.normalizedLemma !== excludedLemma), query);
        const found = await lookupWord(query, "auto");
        assert.equal(found.status, "found", query);
        if (found.status === "found") assert.notEqual(found.entry.normalizedLemma, excludedLemma, query);
      }
      for (const query of fixture.unmatched) assert.deepEqual(await repository.semantic(query, base.dataVersion), [], query);
      const question = await lookupWord("价格不高用加泰语怎么说", "auto");
      assert.equal(question.status, "found");
      if (question.status === "found") {
        assert.equal(question.lemma, "barat");
        assert.equal(question.resolutionSource, "semantic");
        assert.equal(question.semanticMatch?.expression, "价格不高");
      }
    });
    await t.test("source-compared Chinese synonyms resolve by meaning and preserve directional contrasts", async () => {
      const fixture = JSON.parse(await readFile(resolve(root, "data/search/chinese-synonym-cases.json"), "utf8"));
      assert.ok(fixture.cases.length >= 250);
      for (const { query, expectedLemma } of fixture.cases) {
        for (const mode of ["zh", "auto"] as const) {
          const found = await lookupWord(query, mode);
          assert.equal(found.status, "found", `${mode}: ${query}`);
          if (found.status === "found") assert.equal(found.entry.normalizedLemma, expectedLemma, `${mode}: ${query}`);
        }
        assert.equal((await suggestWords(query, "zh"))[0]?.lemma, expectedLemma, `completion: ${query}`);
      }
      for (const { query, expectedLemma, excludedLemma } of fixture.contrasts) {
        const found = await lookupWord(query, "zh");
        assert.equal(found.status, "found", query);
        if (found.status === "found") {
          assert.equal(found.entry.normalizedLemma, expectedLemma, query);
          assert.notEqual(found.entry.normalizedLemma, excludedLemma, query);
        }
      }
    });
    await t.test("corrected machine senses cannot impersonate shy, pretty or lazy meanings", async () => {
      for (const [query, expected, excluded] of [
        ["非常害羞的", "tímid", "inverecund"], ["真漂亮", "bonic", "belador"], ["好吃懒做", "mandrós", "gavardí"],
      ]) {
        const found = await lookupWord(query, "zh");
        assert.equal(found.status, "found", query);
        if (found.status === "found") {
          assert.equal(found.entry.normalizedLemma, expected, query);
          assert.ok(found.candidates.every((candidate) => candidate.entry?.normalizedLemma !== excluded), query);
        }
      }
      for (const [lemma, meaning] of [["inverecund", "无耻"], ["belador", "咩咩叫"], ["gavardí", "Gavarda"]]) {
        const found = await lookupWord(lemma, "ca");
        assert.equal(found.status, "found", lemma);
        if (found.status === "found") {
          assert.ok(primaryChinese(found.entry).includes(meaning), lemma);
          assert.equal(found.entry.chineseMachine, true, "A source-compared correction retains its published layer label");
          if (lemma !== "belador") assert.equal(found.entry.chineseHeadword, true);
        }
      }
    });
    await t.test("contextual Chinese spelling suggestions beat incidental substrings in the real catalogue", async () => {
      for (const [query, lemma] of [["音悦", "música"], ["银航", "banc"]]) {
        const hints = await suggestWords(query, "zh");
        assert.equal(hints[0]?.lemma, lemma, query);
        assert.equal(hints[0]?.kind, "fuzzy");
        const missing = await lookupWord(query, "zh");
        assert.equal(missing.status, "not-found");
        if (missing.status === "not-found") assert.equal(missing.relatedSuggestions?.[0]?.lemma, lemma);
      }
    });
    await t.test("source-compared everyday meanings replace mismatched references without overwriting original Chinese", async () => {
      for (const [query, lemma, meaning] of [
        ["现在", "ara", "现在"], ["昨天", "ahir", "昨天"], ["你好", "hola", "你好"],
        ["西班牙语", "castellà", "西班牙语"], ["紧急", "urgent", "紧急"],
      ]) {
        const found = await lookupWord(query, "zh");
        assert.equal(found.status, "found");
        if (found.status !== "found") continue;
        assert.equal(found.lemma, lemma);
        assert.ok(primaryChinese(found.entry).includes(meaning));
        assert.ok(found.entry.source?.includes("zh-everyday-0001"));
        assert.ok(!found.entry.chineseReference);
        assert.ok(!found.entry.chineseMachine);
      }
      const now = await lookupWord("ara", "ca");
      if (now.status === "found") assert.ok(!primaryChinese(now.entry).includes("星座"));
      const school = await lookupWord("学校", "zh");
      if (school.status === "found") {
        assert.equal(primaryChinese(school.entry), "学校");
        assert.ok(school.entry.chinese?.some((text) => text.includes("學校")), "The source spelling remains available as evidence");
      }
      const mother = await lookupWord("母亲", "zh");
      assert.equal(mother.status, "found");
      if (mother.status === "found") {
        assert.equal(mother.lemma, "mare");
        assert.ok(primaryChinese(mother.entry).startsWith("母亲；妈妈"));
        assert.ok(mother.entry.chinese?.some((meaning) => meaning.includes("子宫")), "Keep the existing reviewed secondary sense");
      }
      const wake = await lookupWord("起床", "zh");
      assert.equal(wake.status, "found");
      if (wake.status === "found") assert.ok(primaryChinese(wake.entry).includes("llevar-se"));
      for (const [query, badLemma] of [["你", "amb vosaltres"], ["我们", "amb nosaltres"], ["她", "el/la"]]) {
        const repo = new SearchRepository();
        const manifest = await dictionaryRepository.manifest();
        const hits = await repo.reverse(query, "zh", manifest.dataVersion);
        assert.ok(!hits.some((hit) => hit.normalizedLemma === badLemma), query);
      }
    });
    await t.test("explicit Chinese questions search the full extracted term and retain visible context", async () => {
      for (const mode of ["auto", "zh"] as const) {
        const query = "请问，公交车用加泰语怎么说？";
        const result = await lookupWord(query, mode);
        assert.equal(result.status, "found");
        if (result.status === "found") assert.equal(result.lemma, "autobús");
        assert.equal(result.searchedForm, query);
        assert.equal(result.extractedQuery, "公交车");
        assert.equal(result.searchLanguage, mode);
        assert.equal((await suggestWords(query, mode))[0]?.lemma, "autobús");
      }
      const negative = await lookupWord("不可以用加泰语怎么说", "zh");
      assert.equal(negative.status, "not-found");
      assert.equal(negative.extractedQuery, "不可以");
      assert.equal((await lookupWord("学校用西班牙语怎么说", "zh")).extractedQuery, undefined);
      assert.equal((await lookupWord("学校怎么说", "ca")).extractedQuery, undefined);
    });
    await t.test("new Chinese meanings and named references resolve to their source lemmas", async () => {
      for (const [query, lemma] of [["石龙子", "lludrió"], ["狐鼬", "taira"], ["图形用户界面", "gui"]] as const) {
        const result = await lookupWord(query, "zh");
        assert.equal(result.status, "found", query);
        if (result.status !== "found") continue;
        assert.ok(result.candidates.some((candidate) => candidate.entry?.normalizedLemma === lemma), query);
        const entry = result.candidates.find((candidate) => candidate.entry?.normalizedLemma === lemma)?.entry;
        assert.ok(entry?.chineseMachine);
        assert.ok(entry.source?.includes("bulk-zh-ms-20261012"));
      }
      const headword = await lookupWord("teb", "ca");
      assert.equal(headword.status, "found");
      if (headword.status === "found") {
        assert.equal(headword.entry.chineseHeadword, true);
        assert.match(primaryChinese(headword.entry), /微温/);
      }
    });

    await t.test("Chinese simplified/traditional, Spanish, and Catalan find escola", async () => {
      for (const [query, mode, matchedLanguage] of [
        ["学校", "zh", "zh"], ["學校", "zh", "zh"], ["escuela", "es", "es"],
        ["escola", "ca", "ca"], ["学校", "auto", "zh"], ["escuela", "auto", "es"],
      ] as const) {
        const result = await lookupWord(query, mode);
        assert.equal(result.status, "found", `${mode}: ${query}`);
        if (result.status !== "found") continue;
        assert.equal(result.entry.normalizedLemma, "escola");
        assert.equal(result.matchedLanguage, matchedLanguage);
        assert.equal(result.searchLanguage, mode);
        assert.match(primaryChinese(result.entry), /[学學]校/);
      }
    });

    await t.test("authored seed synonyms and split Spanish meanings are searchable", async () => {
      const rising = await lookupWord("上升", "zh");
      assert.equal(rising.status, "found");
      if (rising.status === "found") {
        assert.equal(rising.lemma, "pujar");
        assert.equal(rising.resolutionSource, "translation");
      }
      const food = await lookupWord("comida", "es");
      assert.equal(food.status, "found");
      if (food.status === "found") {
        assert.ok(food.candidates.some((candidate) => candidate.lemma === "menjar"));
        const ranks = food.candidates.map((candidate) => candidate.entry?.frequencyRank ?? Number.MAX_SAFE_INTEGER);
        assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
      }
    });

    await t.test("auto preserves both Catalan nombre and Spanish nombre → nom", async () => {
      const automatic = await lookupWord("nombre", "auto");
      assert.equal(automatic.status, "found");
      if (automatic.status === "found") {
        assert.equal(automatic.entry.normalizedLemma, "nombre");
        assert.equal(automatic.matchedLanguage, "ca");
        assert.ok(automatic.candidates.some((candidate) => candidate.lemma === "nom" && candidate.matchedLanguage === "es"));
      }
      const spanish = await lookupWord("nombre", "es");
      assert.equal(spanish.status, "found");
      if (spanish.status === "found") assert.equal(spanish.entry.normalizedLemma, "nom");
      const catalan = await lookupWord("nombre", "ca");
      assert.equal(catalan.status, "found");
      if (catalan.status === "found") assert.equal(catalan.entry.normalizedLemma, "nombre");
    });

    await t.test("accent-optional Spanish search retains ñ as a distinct letter", async () => {
      for (const spelling of ["camión", "CAMION"] as const) {
        const result = await lookupWord(spelling, "es");
        assert.equal(result.status, "found", spelling);
        if (result.status === "found") assert.equal(result.lemma, "camió");
      }
      const repository = new SearchRepository();
      const manifest = await dictionaryRepository.manifest();
      const withEnye = await repository.reverse("niño", "es", manifest.dataVersion);
      const withoutEnye = await repository.reverse("nino", "es", manifest.dataVersion);
      assert.ok(withEnye.some((hit) => hit.normalizedLemma === "nen"));
      assert.deepEqual(withoutEnye, []);
    });

    await t.test("full catalogues offer Spanish and Chinese completions with working lookup targets", async () => {
      for (const [query, language, term, lemma] of [
        ["escue", "es", "escuela", "escola"], ["esceula", "es", "escuela", "escola"],
        ["学校校", "zh", "学校", "escola"], ["图形用户", "zh", "图形用户界面", "gui"],
        ["基礎設", "zh", "基礎設施", "infraestructura"],
      ] as const) {
        const suggestions = await suggestWords(query, language);
        const match = suggestions.find((item) => item.term === term);
        assert.ok(match, `${query}: ${JSON.stringify(suggestions)}`);
        assert.equal(match.language, language);
        const result = await lookupWord(match.term, match.language);
        assert.equal(result.status, "found");
        if (result.status === "found") assert.ok(result.candidates.some((candidate) => candidate.entry?.normalizedLemma === lemma));
      }
      const miss = await lookupWord("esceula", "es");
      assert.equal(miss.status, "not-found");
      if (miss.status === "not-found") assert.ok(miss.relatedSuggestions?.some((item) => item.term === "escuela" && item.language === "es"));
      const exact = await lookupWord("escuela", "es");
      assert.equal(exact.status, "found", "Fuzzy search must never replace an exact lookup");
    });

    await t.test("Chinese relevance handles homophones, mixed scripts and everyday aliases", async () => {
      for (const [query, lemma] of [["学小", "escola"], ["敢冒", "refredat"], ["苹国", "poma"], ["火车战", "estació de tren"],
        ["基礎设施", "infraestructura"], ["图形 用戶界面", "gui"], ["学校的", "escola"],
        ["吃饭", "menjar"], ["早上好", "bon dia"], ["早安", "bon dia"], ["晚安", "bona nit"], ["火车站", "estació de tren"]] as const) {
        const suggestions = await suggestWords(query, "zh");
        assert.equal(normalizeCatalanInput(suggestions[0]?.lemma ?? ""), lemma, `${query}: ${JSON.stringify(suggestions)}`);
        const opened = await lookupWord(suggestions[0].term, "zh");
        assert.equal(opened.status, "found");
        if (opened.status === "found") assert.equal(opened.entry.normalizedLemma, lemma, query);
      }
      for (const query of ["基礎设施", "图形 用戶界面", "「学校？」"]) {
        assert.equal((await lookupWord(query, "zh")).status, "found", query);
      }
      const station = await lookupWord("火車站", "zh");
      assert.equal(station.status, "found");
      if (station.status === "found") assert.equal(station.entry.normalizedLemma, "estació de tren");
      const typo = await lookupWord("学小", "zh");
      assert.equal(typo.status, "not-found", "A homophone suggestion never silently replaces the query");
      const greeting = await lookupWord("早上好", "zh");
      if (greeting.status === "found") assert.ok(!greeting.candidates.some((item) => item.lemma === "matisació"));
      const matisacio = await lookupWord("matisació", "ca");
      assert.equal(matisacio.status, "found");
      if (matisacio.status === "found") assert.ok(!primaryChinese(matisacio.entry).includes("早上好"));
      for (const [lemma, meaning, excluded] of [
        ["llibreterament", "在书商业务方面", "自由地"],
        ["vialment", "在道路交通方面", "正确地"],
        ["viàriament", "在道路交通方面", "正确地"],
      ]) {
        const corrected = await lookupWord(lemma, "ca");
        assert.equal(corrected.status, "found", lemma);
        if (corrected.status === "found") {
          assert.equal(primaryChinese(corrected.entry), meaning, lemma);
          assert.equal(corrected.entry.chineseMachine, true, lemma);
          assert.ok(corrected.entry.provenance?.some(item => item.sourceId === "bulk-zh-ms-20261012"), lemma);
          assert.ok(!primaryChinese(corrected.entry).includes(excluded), lemma);
        }
      }
    });

    await t.test("source-compared everyday cases open the intended common Catalan word", async () => {
      const cases = JSON.parse(await readFile(resolve(root, "data/search/everyday-cases.json"), "utf8")) as {
        cases: Array<{ query: string; preferredLemma: string; sourceAliasLemma: string }>;
      };
      assert.ok(cases.cases.length >= 35);
      for (const item of cases.cases) {
        for (const mode of ["zh", "auto"] as const) {
          const result = await lookupWord(item.query, mode);
          assert.equal(result.status, "found", `${mode}: ${item.query}`);
          if (result.status === "found") assert.equal(result.entry.normalizedLemma, item.preferredLemma, item.query);
        }
        const suggestions = await suggestWords(item.query, "zh");
        assert.equal(normalizeCatalanInput(suggestions[0]?.lemma ?? ""), item.preferredLemma, item.query);
      }
    });

    await t.test("prose examples and grammatical references do not impersonate Chinese translations", async () => {
      const repository = new SearchRepository();
      const base = await dictionaryRepository.manifest();
      for (const [query, excluded] of [["你好", "la hi"], ["西班牙语", "interlingua"], ["火车", "linòleum"], ["超市", "supramunicipal"]] as const) {
        const hits = await repository.reverse(query, "zh", base.dataVersion);
        assert.ok(!hits.some((hit) => hit.normalizedLemma === excluded), `${query} leaked from ${excluded}`);
      }
      const wrong = await lookupWord("不可以", "zh");
      if (wrong.status === "not-found") assert.ok(!wrong.relatedSuggestions?.some((item) => item.term === "可以"));
    });

    await t.test("Chinese last-range routing includes normal and supplementary characters", async () => {
      const repository = new SearchRepository();
      const manifest = await dictionaryRepository.manifest();
      for (const [query, lemma] of [["飞机", "avió"], ["铀", "urani"], ["𰾄", "americi"]] as const) {
        const hits = await repository.reverse(query, "zh", manifest.dataVersion);
        assert.ok(hits.some((hit) => hit.normalizedLemma === lemma), `${query} → ${lemma}`);
      }
      const search = await repository.manifest();
      for (const language of ["zh", "es"] as const) {
        let previous = "";
        for (const descriptor of search.indexes[language]) {
          assert.ok(descriptor.first <= descriptor.last);
          assert.ok(!previous || previous < descriptor.first);
          const rows = JSON.parse(gunzipSync(await readFile(resolve(publicRoot, descriptor.path.slice(1)))).toString()) as Array<[string, unknown]>;
          assert.deepEqual(rows.map(([key]) => key), rows.map(([key]) => key).sort());
          assert.equal(rows[0][0], descriptor.first);
          assert.equal(rows.at(-1)?.[0], descriptor.last);
          previous = descriptor.last;
        }
      }
    });

    await t.test("a failed full catalogue download still offers common core translations", async () => {
      const currentFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) => String(input).includes("/suggestions/")
        ? new Response(null, { status: 503 }) : currentFetch(input, init);
      try {
        const fresh = new SearchRepository();
        const base = await dictionaryRepository.manifest();
        assert.ok((await fresh.suggest("escue", "es", base.dataVersion)).some((item) => item.term === "escuela"));
      } finally { globalThis.fetch = currentFetch; }
    });

    await t.test("Wordnet equivalents resolve to Catalan with source and synset provenance", async () => {
      const result = await lookupWord("基础设施", "zh");
      assert.equal(result.status, "found");
      if (result.status !== "found") return;
      assert.equal(result.lemma, "infraestructura");
      assert.equal(result.entry.chineseReference, true);
      assert.ok(result.entry.source?.includes("omw-mcr-cow"));
      assert.ok(result.entry.provenance?.some((source) =>
        source.sourceId === "omw-mcr-cow" && source.sourceEntryId === "pwn-3.0:03569964-n"));
      assert.match(primaryChinese(result.entry), /基础设施/);
      const traditional = await lookupWord("基礎設施", "zh");
      assert.equal(traditional.status, "found");
      if (traditional.status === "found") assert.equal(traditional.lemma, "infraestructura");
    });

    await t.test("core offline uses complete definitions and reverse indexes without extended downloads", async () => {
      coreOnly = true;
      requested.length = 0;
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
      // A fresh repository proves the result comes from actual core assets,
      // rather than a full-index shard retained by an earlier online subtest.
      const fresh = new SearchRepository();
      const base = await dictionaryRepository.manifest();
      const coreSchool = await fresh.coreEntry("escola", base.dataVersion);
      assert.ok(coreSchool?.d?.ca?.length || coreSchool?.d?.en?.length);
      assert.ok((await fresh.reverse("学校", "zh", base.dataVersion)).some((hit) => hit.normalizedLemma === "escola"));
      assert.ok((await fresh.reverse("escuela", "es", base.dataVersion)).some((hit) => hit.normalizedLemma === "escola"));
      assert.ok((await fresh.suggest("escue", "es", base.dataVersion)).some((item) => item.term === "escuela"));
      assert.ok((await fresh.suggest("学校校", "zh", base.dataVersion)).some((item) => item.term === "学校"));
      assert.equal((await fresh.suggest("学小", "zh", base.dataVersion))[0]?.lemma, "escola");
      assert.equal((await fresh.semantic("不用付钱", base.dataVersion))[0]?.normalizedLemma, "gratuït");
      assert.deepEqual(await fresh.semantic("价格不高", base.dataVersion), [], "A non-core concept must stay outside the core download");
      assert.ok((await fresh.reverse("「学 校？」", "zh", base.dataVersion)).some((hit) => hit.normalizedLemma === "escola"));
      for (const [query, mode, lemma] of [
        ["学校", "zh", "escola"], ["學校", "zh", "escola"], ["escuela", "es", "escola"],
        ["escola", "ca", "escola"], ["上升", "zh", "pujar"], ["pujant", "ca", "pujar"],
      ] as const) {
        const result = await lookupWord(query, mode);
        assert.equal(result.status, "found", query);
        if (result.status !== "found") continue;
        assert.equal(result.entry.normalizedLemma, lemma);
        assert.ok(primaryChinese(result.entry));
        if (lemma === "escola") assert.ok(result.entry.definitions?.ca?.length || result.entry.definitions?.en?.length);
      }
      assert.ok(requested.some((path) => path.includes("/core/entries.json.gz")));
      assert.ok(requested.some((path) => path.includes("/core/zh.json.gz")));
      assert.ok(requested.some((path) => path.includes("/core/es.json.gz")));
      const missed = await lookupWord("这个词根本不存在", "zh");
      assert.equal(missed.status, "not-found");
      if (missed.status === "not-found") assert.equal(missed.offlineLimited, true);
      assert.ok(requested.every((path) => path.endsWith("/manifest.json") || path.includes("/core/")));
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("cache identity includes input language and preserves meaningful Spanish distinctions", () => {
  assert.equal(searchCacheKey("  NIÑO  ", "es"), "es:niño");
  assert.notEqual(searchCacheKey("nombre", "ca"), searchCacheKey("nombre", "es"));
  assert.notEqual(searchCacheKey("nombre", "auto"), searchCacheKey("nombre", "es"));
  assert.notEqual(searchCacheKey("niño", "es"), searchCacheKey("nino", "es"));
  assert.notEqual(searchCacheKey("camión", "es"), searchCacheKey("camion", "es"));
  assert.equal(normalizeSearchKey("CAMIÓN", "es"), normalizeSearchKey("camion", "es"));
  assert.equal(normalizeSearchKey("Pingüino", "es"), "pinguino");
});

test("Python build keys and TypeScript query keys apply the same normalization", () => {
  const vectors: Array<["es" | "zh", string]> = [
    ["es", "  CAMIÓN  "], ["es", "NIÑO"], ["es", "nino"], ["es", "niño"], ["es", "Pingüino"],
    ["es", "L’ESCOLA"], ["es", "coŀlegi"], ["es", "col•legi"], ["es", "x—y"],
    ["es", "\ufeffniño\ufeff"], ["zh", "學校"], ["zh", "学校"], ["zh", " Ａ　学校 "],
    ["zh", "L’學校—Ａ"], ["zh", "coŀlegi"], ["zh", "\ufeff学校\ufeff"], ["zh", "𰾄"],
  ];
  const script = "import json,sys;sys.path.insert(0,sys.argv[1]);import build_search as b;" +
    "print(json.dumps([b.spanish_key(s) if lang=='es' else b.chinese_key(s) for lang,s in json.loads(sys.argv[2])],ensure_ascii=False))";
  const result = spawnSync("python3", ["-c", script, resolve(root, "scripts/dictionary"), JSON.stringify(vectors)], {
    encoding: "utf8", timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), vectors.map(([language, value]) => normalizeSearchKey(value, language)));
});

test("search download lists bind core and all full assets to the same immutable version", async () => {
  const manifest = JSON.parse(await readFile(resolve(publicRoot, "dictionary/search/manifest.json"), "utf8")) as SearchManifest;
  const core = new Set(manifest.offline.core.map((descriptor) => descriptor.path));
  assert.ok(manifest.semantic);
  assert.deepEqual(core, new Set([manifest.core.entries.path, manifest.core.zh.path, manifest.core.es.path, manifest.semantic.core.path]));
  const full = new Set(manifest.offline.full.map((descriptor) => descriptor.path));
  assert.equal(full.size, manifest.offline.full.length);
  assert.ok(manifest.suggestions);
  for (const descriptor of [...manifest.offline.core, ...manifest.indexes.zh, ...manifest.indexes.es, ...manifest.chinese, ...Object.values(manifest.suggestions), ...Object.values(manifest.semantic)]) {
    assert.ok(full.has(descriptor.path));
    assert.ok(descriptor.path.startsWith(`/dictionary/search/${manifest.dataVersion}/`));
    assert.match(descriptor.sha256 ?? "", /^[a-f0-9]{64}$/);
  }
});

test("full suggestion catalogues are checksummed and derive every term from accepted reverse postings", async () => {
  const manifest = JSON.parse(await readFile(resolve(publicRoot, "dictionary/search/manifest.json"), "utf8")) as SearchManifest;
  for (const language of ["es", "zh"] as const) {
    const descriptor = manifest.suggestions![language];
    const compressed = await readFile(resolve(publicRoot, descriptor.path.slice(1)));
    assert.equal(createHash("sha256").update(compressed).digest("hex"), descriptor.sha256);
    const catalogue = JSON.parse(gunzipSync(compressed).toString()) as SuggestionRow[];
    const postings = (await Promise.all(manifest.indexes[language].map(async (shard) =>
      JSON.parse(gunzipSync(await readFile(resolve(publicRoot, shard.path.slice(1)))).toString()) as Array<[string, Array<[string, string, string]>]>
    ))).flat();
    assert.deepEqual(catalogue.map((row) => row[0]), postings.map((row) => row[0]));
    for (let i = 0; i < catalogue.length; i += 1) {
      const [key, term, lemma, rank] = catalogue[i];
      assert.equal(normalizeCatalanInput(lemma), postings[i][1][0][0]);
      assert.equal(term, language === "zh" ? key : postings[i][1][0][1]);
      assert.ok(Number.isFinite(rank));
    }
  }
});

test("everyday Chinese aliases reject changed source evidence and stale base versions", () => {
  const script = `
import json,sys,tempfile
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import build_search as b
data=json.loads(Path(sys.argv[2]).read_text())
data['records']=[next(r for r in data['records'] if r['lemma']=='menjar')]
records={'menjar':[('seed',{'zh':['吃']}),('lex',{'es':['comer']}),('wiktionary',{'d':{'en':['to eat something solid']}})]}
with tempfile.TemporaryDirectory() as directory:
 p=Path(directory)/'aliases.json'
 p.write_text(json.dumps(data))
 assert b.search_aliases(p,records,data['baseDataVersion'])=={'menjar':['吃饭','进食','用餐']}
 for mode in ('evidence','base'):
  changed=json.loads(json.dumps(data))
  if mode=='evidence': changed['records'][0]['evidence'][0]['text']='unrelated'
  else: changed['baseDataVersion']='stale'
  p.write_text(json.dumps(changed))
  try: b.search_aliases(p,records,data['baseDataVersion'])
  except ValueError: pass
  else: raise AssertionError('Unbound alias was accepted: '+mode)
`;
  const result = spawnSync("python3", ["-c", script, resolve(root, "scripts/dictionary"), resolve(root, "data/search/chinese-aliases.json")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("a transient base/search version mismatch can recover on the same repository", async () => {
  const previousFetch = globalThis.fetch;
  const manifest = JSON.parse(await readFile(resolve(publicRoot, "dictionary/search/manifest.json"), "utf8")) as SearchManifest;
  let requests = 0;
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    assert.equal(String(input), "/dictionary/search/manifest.json");
    requests += 1;
    return Response.json({ ...manifest, baseDataVersion: requests === 1 ? "wrong-deployment-version" : manifest.baseDataVersion });
  };
  try {
    const repository = new SearchRepository();
    await assert.rejects(repository.manifest(manifest.baseDataVersion), /versions differ/);
    assert.equal((await repository.manifest(manifest.baseDataVersion)).baseDataVersion, manifest.baseDataVersion);
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("semantic downloads preserve every source-bound expression and restrict the core to installed lemmas", async () => {
  const manifest = JSON.parse(await readFile(resolve(publicRoot, "dictionary/search/manifest.json"), "utf8")) as SearchManifest;
  assert.ok(manifest.semantic);
  const packs: unknown[][][] = [];
  for (const descriptor of [manifest.semantic.zh, manifest.semantic.core]) {
    const bytes = await readFile(resolve(publicRoot, descriptor.path.slice(1)));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), descriptor.sha256);
    const rows = JSON.parse(gunzipSync(bytes).toString()) as unknown[][];
    packs.push(rows);
    assert.ok(rows.every((row) => (row.length === 6 || row.length === 7) && typeof row[5] === "string"));
  }
  const coreEntries = JSON.parse(gunzipSync(await readFile(resolve(publicRoot, manifest.core.entries.path.slice(1)))).toString()) as Array<{ n: string }>;
  const coreLemmas = new Set(coreEntries.map((entry) => entry.n));
  const fullRows = new Set(packs[0].map((row) => JSON.stringify(row)));
  for (const row of packs[1]) {
    assert.ok(coreLemmas.has(row[2] as string));
    assert.ok(fullRows.has(JSON.stringify(row)));
  }
  const fixture = JSON.parse(await readFile(resolve(root, "data/search/chinese-semantic-cases.json"), "utf8"));
  for (const { query, expectedLemma, label } of fixture.cases) {
    assert.ok(packs[0].some((row) => row[1] === query && row[2] === expectedLemma && row[3] === label), query);
  }
});
