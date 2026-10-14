import assert from "node:assert/strict";
import test from "node:test";
import { semanticRows } from "../lib/chinese-semantic.ts";
import type { ChineseSemanticRow } from "../lib/chinese-semantic.ts";

test("meaning expressions match without shared spelling and retain negation and direction", () => {
  const rows: ChineseSemanticRow[] = [
    ["不开心", "不开心", "trist", "难过", 1, "sad"],
    ["价格不高", "价格不高", "barat", "便宜", 2, "cheap"],
    ["借给别人", "借给别人", "prestar", "借出", 3, "lend"],
    ["向别人借东西", "向别人借东西", "manllevar", "借入", 4, "borrow"],
    ["心情好", "心情好", "feliç", "开心", 5, "happy"],
  ].sort((a, b) => a[0] < b[0] ? -1 : 1) as ChineseSemanticRow[];
  for (const [query, lemma] of [["價格不高", "barat"], ["不开心", "trist"], ["心情好", "feliç"],
    ["借给别人", "prestar"], ["向别人借东西", "manllevar"]]) {
    assert.equal(semanticRows(rows, query)[0]?.[2], lemma);
  }
  for (const query of ["不要借给别人", "不是价格不高", "不怎么开心", "心情浩", "心情", "不存在的说法"])
    assert.deepEqual(semanticRows(rows, query), [], query);
  assert.deepEqual(semanticRows(rows, "心情好", 0), []);
});

test("an older search manifest without a concept layer keeps lexical lookup compatible", async () => {
  const { SearchRepository } = await import("../lib/search-repository.ts");
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ schemaVersion: 1, baseDataVersion: "old-base", dataVersion: "old-search", core: { entries: {} } });
  try {
    assert.deepEqual(await new SearchRepository().semantic("借书的地方", "old-base"), []);
  } finally { globalThis.fetch = previousFetch; }
});
