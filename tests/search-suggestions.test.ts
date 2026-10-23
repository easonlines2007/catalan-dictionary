import assert from "node:assert/strict";
import test from "node:test";
import { matchSuggestions } from "../lib/search-suggestions.ts";
import type { SuggestionRow } from "../lib/search-suggestions.ts";
import { chineseMatchingKey, chineseWordReadings, sameChineseReading } from "../lib/chinese-search.ts";

test("completions rank exact, prefix and internal terms ahead of spelling corrections", async () => {
  const rows: SuggestionRow[] = [
    ["escuela", "escuela", "escola", 10],
    ["escuela primaria", "escuela primaria", "escola primària", 30],
    ["autoescuela", "autoescuela", "autoescola", 1],
    ["escuelas", "escuelas", "escoles", 2],
  ];
  const suggestions = await matchSuggestions(rows, "escuela", "es");
  assert.deepEqual(suggestions.map((item) => item.kind), ["exact", "prefix", "prefix", "contains"]);
  assert.equal(suggestions[0].lemma, "escola");
  assert.equal((await matchSuggestions(rows, "esceula", "es"))[0]?.term, "escuela");
  assert.equal((await matchSuggestions(rows, "ezcuela", "es"))[0]?.kind, "fuzzy");
});

test("Chinese partial terms, traditional spellings and typos remain language-bound", async () => {
  const rows: SuggestionRow[] = [
    ["学校", "学校", "escola", 10], ["學校", "學校", "escola", 10],
    ["高等学校", "高等学校", "universitat", 20], ["小学", "小学", "escola primària", 30],
    ["𰾄元素", "𰾄元素", "americi", 100],
  ];
  assert.equal((await matchSuggestions(rows, "学", "zh"))[0]?.term, "学校");
  const internal = await matchSuggestions(rows, "学校", "zh");
  assert.equal(internal.find((item) => item.term === "高等学校")?.kind, "contains");
  assert.equal((await matchSuggestions(rows, "學", "zh"))[0]?.term, "學校");
  assert.equal((await matchSuggestions(rows, "学小", "zh"))[0]?.term, "学校");
  assert.equal((await matchSuggestions(rows, "𰾄元数", "zh"))[0]?.lemma, "americi");
  assert.ok(internal.every((item) => item.language === "zh"));
});

test("Spanish accents fold while ñ remains a spelling distinction", async () => {
  const rows: SuggestionRow[] = [["camion", "camión", "camió", 10], ["niño", "niño", "nen", 20]];
  assert.equal((await matchSuggestions(rows, "CAMIÓN", "es"))[0]?.kind, "exact");
  assert.equal((await matchSuggestions(rows, "nino", "es"))[0]?.kind, "fuzzy");
});

test("traditional-only catalogues still offer simplified previews for simplified input", async () => {
  const rows: SuggestionRow[] = [["學校", "學校", "escola", 10], ["哀傷", "哀傷", "trist", 20]];
  assert.equal((await matchSuggestions(rows, "学校", "zh"))[0]?.term, "学校");
  assert.equal((await matchSuggestions(rows, "哀伤", "zh"))[0]?.term, "哀伤");
  assert.equal((await matchSuggestions(rows, "學校", "zh"))[0]?.term, "學校");
  assert.equal((await matchSuggestions(rows, "哀傷", "zh"))[0]?.term, "哀傷");
});

test("Chinese matching joins mixed scripts, accidental Han spaces and edge punctuation", async () => {
  assert.equal(chineseMatchingKey("「基礎设施？」"), "基础设施");
  assert.equal(chineseMatchingKey("图形 用戶界面"), "图形用户界面");
  const rows: SuggestionRow[] = [["基础设施", "基础设施", "infraestructura", 100], ["基礎設施", "基礎設施", "infraestructura", 100]];
  const results = await matchSuggestions(rows, "基礎设施", "zh");
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, "exact");
  assert.equal(results[0].lemma, "infraestructura");
  assert.equal((await matchSuggestions(rows, "基础", "zh"))[0].term, "基础设施");
  assert.equal((await matchSuggestions(rows, "基礎", "zh"))[0].term, "基礎設施");
});

test("bounded same-reading typos outrank unrelated but frequent Chinese words", async () => {
  const rows: SuggestionRow[] = [["小", "小", "petit", 1], ["学说", "学说", "teoria", 2],
    ["学校", "学校", "escola", 2118], ["學校", "學校", "escola", 2118]];
  assert.equal((await matchSuggestions(rows, "学小", "zh"))[0].lemma, "escola");
  assert.equal((await matchSuggestions(rows, "学小", "zh"))[0].kind, "fuzzy");
  assert.equal((await matchSuggestions(rows, "学小", "zh")).length, 1);
  assert.deepEqual(await matchSuggestions(rows, "穴笑", "zh"), [], "Changing every character must not produce phonetic guesses");
  assert.ok(sameChineseReading("吕", "律"));
  assert.ok(!sameChineseReading("吕", "路"));
});

test("headword hints outrank prose and Chinese results do not repeat the same lemma", async () => {
  const rows: SuggestionRow[] = [["学校", "学校", "escola", 2118], ["學校", "學校", "escola", 2118],
    ["学年刚开始时,学校的老生对新生开的恶作剧", "学年刚开始时,学校的老生对新生开的恶作剧", "patenta", 1],
    ["学校地", "学校地", "escolarment", 1]];
  const results = await matchSuggestions(rows, "学校的", "zh");
  assert.equal(results[0].lemma, "escola");
  assert.equal(results[0].kind, "related");
  assert.equal((await matchSuggestions(rows, "学", "zh")).filter((item) => item.lemma === "escola").length, 1);
  const exact = await matchSuggestions([...rows, ["学校的", "学校的", "escolar", 3000]], "学校的", "zh");
  assert.equal(exact[0].lemma, "escolar", "An existing exact adjective wins over a stripped modifier");
});

test("polyphonic spelling hints follow source phrase readings without expanding every possible sound", async () => {
  const rows: SuggestionRow[] = [["银行", "银行", "banc", 100], ["音乐", "音乐", "música", 200],
    ["行李", "行李", "equipatge", 300], ["重庆", "重庆", "Chongqing", 400],
    ["声音悦耳", "声音悦耳", "sonor", 1],
    ["银杏", "银杏", "ginkgo", 500]];
  assert.deepEqual(chineseWordReadings("银行账户"), ["yin", "hang", "zhang", "hu"]);
  assert.deepEqual(chineseWordReadings("音乐"), ["yin", "yue"]);
  assert.deepEqual(chineseWordReadings("行李"), ["xing", "li"]);
  for (const [query, lemma] of [["银航", "banc"], ["音悦", "música"], ["音樂", "música"], ["充庆", "Chongqing"]]) {
    assert.equal((await matchSuggestions(rows, query, "zh"))[0]?.lemma, lemma, query);
  }
  const unrelated = await matchSuggestions(rows, "银形", "zh");
  assert.equal(unrelated[0].lemma, "ginkgo");
  assert.ok(!unrelated.some((item) => item.lemma === "banc"), "银行 must use háng rather than an arbitrary alternative reading");
});

test("real Chinese matches are not padded with unrelated fuzzy words regardless of row order", async () => {
  const rows: SuggestionRow[] = [["头骨", "头骨", "crani", 1], ["锁骨", "锁骨", "clavícula", 200], ["无锁骨的", "无锁骨的", "aclide", 300]];
  for (const order of [rows, [...rows].reverse()]) {
    assert.deepEqual((await matchSuggestions(order, "锁骨", "zh")).map((item) => item.lemma), ["clavícula", "aclide"]);
  }
});

test("Chinese spelling suggestions preserve negation and explicit quantities", async () => {
  const rows: SuggestionRow[] = [["可以", "可以", "poder", 1], ["不可以", "不可以", "no poder", 10],
    ["未知", "未知", "desconegut", 20], ["无糖", "无糖", "sense sucre", 30],
    ["二月", "二月", "febrer", 40], ["三月", "三月", "març", 50],
    ["12号", "12号", "dia 12", 60], ["13号", "13号", "dia 13", 70]];
  assert.ok(!(await matchSuggestions(rows, "不可以以", "zh")).some((item) => item.lemma === "poder"));
  assert.ok(!(await matchSuggestions(rows, "不可已", "zh")).some((item) => item.lemma === "poder"));
  assert.ok(!(await matchSuggestions(rows, "二约", "zh")).some((item) => item.lemma === "març"));
  assert.equal((await matchSuggestions(rows, "二约", "zh"))[0]?.lemma, "febrer");
  assert.ok(!(await matchSuggestions(rows, "12好", "zh")).some((item) => item.lemma === "dia 13"));
  assert.equal((await matchSuggestions(rows, "12好", "zh"))[0]?.lemma, "dia 12");
  assert.equal((await matchSuggestions(rows, "无塘", "zh"))[0]?.lemma, "sense sucre");
});

test("short inputs, unrelated terms, result caps and cancelled work stay bounded", async () => {
  const rows: SuggestionRow[] = Array.from({ length: 20 }, (_, i) => [`casa ${i}`, `casa ${i}`, `casa ${i}`, i]);
  assert.deepEqual(await matchSuggestions(rows, "c", "es"), []);
  assert.deepEqual(await matchSuggestions(rows, "xyzxyz", "es"), []);
  assert.deepEqual(await matchSuggestions(rows, "casa", "es", 0), []);
  assert.equal((await matchSuggestions(rows, "casa", "es", 3)).length, 3);
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await matchSuggestions(rows, "casa", "es", 8, controller.signal), []);
  const duringWork = new AbortController();
  const manyRows = Array.from({ length: 10000 }, (_, i): SuggestionRow => [`casa ${i}`, `casa ${i}`, "casa", i]);
  setTimeout(() => duringWork.abort(), 0);
  assert.deepEqual(await matchSuggestions(manyRows, "casa", "es", 8, duringWork.signal), []);
});
