import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { lookupWord, suggestWords } from "../lib/lookup.ts";

const publicRoot = resolve(import.meta.dirname, "../public");

test("meaning requests retrieve real Catalan entries and suggestions with full payload context", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "https://meaning.test.invalid");
    assert.equal(url.origin, "https://meaning.test.invalid");
    const path = resolve(publicRoot, url.pathname.replace(/^\/+/, ""));
    assert.ok(path.startsWith(publicRoot + sep));
    try { return new Response(await readFile(path)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Response(null, { status: 404 });
      throw error;
    }
  };
  try {
    for (const [query, payload, expected] of [
      ["表示价格不高的词", "价格不高", "barat"],
      ["形容有点难过的加泰语单词", "有点难过", "trist"],
      ["我想找一个表示不用付钱的词", "不用付钱", "gratuït"],
      ["有没有一个形容不开心的词", "不开心", "trist"],
      ["加泰语里表示“借给别人”的词", "借给别人", "prestar"],
      ["表示向别人借东西的词", "向别人借东西", "manllevar"],
      ["一个意思是重量小的词语", "重量小", "lleuger"],
      ["加泰语中形容体积小的单词", "体积小", "petit"],
      ["形容非常害羞的词", "非常害羞", "tímid"],
      ["表示二月的加泰语说法", "二月", "febrer"],
    ]) {
      for (const mode of ["auto", "zh"] as const) {
        const found = await lookupWord(query, mode);
        assert.equal(found.status, "found", `${mode}: ${query}`);
        if (found.status === "found") assert.equal(found.entry.normalizedLemma, expected, query);
        assert.equal(found.extractedQuery, payload, query);
        assert.equal(found.searchedForm, query, query);
        assert.equal(found.searchLanguage, mode);
        const hints = await suggestWords(query, mode);
        assert.equal(hints[0]?.lemma, expected, query);
        const selected = await lookupWord(hints[0].term, hints[0].language);
        assert.equal(selected.status, "found", query);
        if (selected.status === "found") assert.equal(selected.entry.normalizedLemma, expected, query);
      }
    }
    for (const [query, payload] of [["表示不是很开心的词", "不是很开心"],
      ["表示没有说不安全的词", "没有说不安全"], ["表示三十五个人的词", "三十五个人"]]) {
      const found = await lookupWord(query, "auto");
      assert.equal(found.extractedQuery, payload);
      assert.equal(found.status, "not-found", query);
    }
    for (const mode of ["ca", "es"] as const)
      assert.equal((await lookupWord("表示价格不高的词", mode)).extractedQuery, undefined);
    for (const query of ["形容难过的英语单词", "英语里表示难过的词", "形容表示难过的词的词"])
      assert.equal((await lookupWord(query, "auto")).extractedQuery, undefined);
  } finally { globalThis.fetch = previousFetch; }
});
