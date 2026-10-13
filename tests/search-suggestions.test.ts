import assert from "node:assert/strict";
import test from "node:test";
import { matchSuggestions } from "../lib/search-suggestions.ts";
import type { SuggestionRow } from "../lib/search-suggestions.ts";
import { chineseMatchingKey, sameChineseReading } from "../lib/chinese-search.ts";

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

test("real Chinese matches are not padded with unrelated fuzzy words regardless of row order", async () => {
  const rows: SuggestionRow[] = [["头骨", "头骨", "crani", 1], ["锁骨", "锁骨", "clavícula", 200], ["无锁骨的", "无锁骨的", "aclide", 300]];
  for (const order of [rows, [...rows].reverse()]) {
    assert.deepEqual((await matchSuggestions(order, "锁骨", "zh")).map((item) => item.lemma), ["clavícula", "aclide"]);
  }
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
