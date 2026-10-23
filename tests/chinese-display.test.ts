import assert from "node:assert/strict";
import test from "node:test";
import { formatChineseMeanings } from "../lib/chinese-display.ts";
import { simplifyChinese } from "../lib/chinese-search.ts";
import { primaryChinese, primarySpanish } from "../lib/types.ts";
import type { DictionaryEntry } from "../lib/types.ts";

test("Chinese meanings use simplified text and coalesce script variants in source order", () => {
  assert.equal(formatChineseMeanings(["學校", "学校；學校", "學院；学院", ""]), "学校；学院");
  assert.equal(formatChineseMeanings(["哀傷；悲傷", "悲伤", "難過\n難過"]), "哀伤；悲伤；难过");
  assert.equal(formatChineseMeanings([" 學校 ; 学校；教育機構 "]), "学校；教育机构");
  assert.equal(formatChineseMeanings(undefined), "");
  assert.equal(formatChineseMeanings([" ", "；;\n"]), "");
});

test("phrase conversion and punctuation retain the distinctions and context of each meaning", () => {
  assert.equal(simplifyChinese("乾坤與乾燥，發展與頭髮"), "乾坤与干燥，发展与头发");
  assert.equal(formatChineseMeanings(["軟體（臺灣；電腦用語）", "软件", "軟體（臺灣；電腦用語）"]),
    "软体（台湾；电脑用语）；软件");
  assert.equal(formatChineseMeanings(["「學校；教育機構」", "學校", "學校（古義）"]),
    "「学校；教育机构」；学校；学校（古义）");
  assert.equal(formatChineseMeanings(["無糖；低糖；不安全；安全；借入；借出"]),
    "无糖；低糖；不安全；安全；借入；借出");
  assert.equal(simplifyChinese("這是 l'escola，位於 Barcelona。"), "这是 l'escola，位于 Barcelona。");
});

test("displaying old saved entries and history does not rewrite the original evidence", () => {
  const entry: DictionaryEntry = {
    lemma: "escola", normalizedLemma: "escola", chinese: ["學校；学校"],
    definitions: { zh: ["學校"] }, spanish: ["escuela"],
    examples: [{ ca: "És una escola.", zh: "這是一所學校。" }],
    chineseReference: true, chineseMachine: true, chineseHeadword: true,
    source: ["source-reference"], provenance: [{ sourceId: "cow", sourceEntryId: "synset-123" }],
  };
  const original = structuredClone(entry);
  assert.equal(primaryChinese(entry), "学校");
  assert.equal(primarySpanish(entry), "escuela");
  assert.equal(simplifyChinese(entry.examples![0].zh!), "这是一所学校。");
  assert.deepEqual(entry, original);
  const oldHistory = { query: "學校", meaning: "學校；学校", timestamp: 123 };
  assert.equal(formatChineseMeanings([oldHistory.meaning]), "学校");
  assert.deepEqual(oldHistory, { query: "學校", meaning: "學校；学校", timestamp: 123 });
  assert.equal(primaryChinese({ lemma: "trist", normalizedLemma: "trist", definitions: { zh: ["哀傷"] } }), "哀伤");
  assert.equal(primaryChinese({ lemma: "trist", normalizedLemma: "trist", chinese: [" "], definitions: { zh: ["難過"] } }), "难过");
});
