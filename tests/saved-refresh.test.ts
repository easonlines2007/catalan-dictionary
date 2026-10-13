import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { getSavedWords, removeSavedWord, saveWord, updateSavedSnapshot } from "../lib/storage.ts";
import { refreshSavedSnapshots } from "../lib/saved-refresh.ts";
import type { DictionaryEntry, FoundLookup, SavedRecord } from "../lib/types.ts";

function result(lemma: string, chinese: string, version = "old"): FoundLookup {
  return { status: "found", searchedForm: lemma, normalizedQuery: lemma, lemma,
    entry: { lemma, normalizedLemma: lemma, chinese: [chinese], chineseMachine: true },
    resolutionSource: "exact", confidence: 1, candidates: [], searchDataVersion: version };
}

test("saved corrections persist with versions while preserving dates, order and machine labels", async () => {
  const old = await saveWord(result("matisació", "错误的问候"), "base");
  const fresh: DictionaryEntry = { ...old.entry, chinese: ["修饰；细微差别的调整"] };
  const updated = await updateSavedSnapshot(old, fresh, "base", "new");
  assert.equal(updated?.savedAt, old.savedAt);
  assert.equal(updated?.revision, old.revision);
  assert.equal(updated?.searchDataVersion, "new");
  const stored = (await getSavedWords()).find((record) => record.lemma === old.lemma);
  assert.deepEqual(stored?.entry.chinese, fresh.chinese);
  assert.equal(stored?.entry.chineseMachine, true);
  assert.equal(await updateSavedSnapshot(old, fresh, "base", "even-newer"), undefined);
});

test("snapshot refresh never resurrects removals or overwrites intervening re-saves", async () => {
  const removed = await saveWord(result("removed", "旧"), "base");
  await removeSavedWord(removed.lemma);
  assert.equal(await updateSavedSnapshot(removed, removed.entry, "base", "new"), undefined);
  const old = await saveWord(result("resaved", "旧"), "base");
  const newer = await saveWord(result("resaved", "新收藏", "latest"), "base");
  assert.notEqual(old.revision, newer.revision);
  assert.equal(await updateSavedSnapshot(old, old.entry, "base", "new"), undefined);
  assert.deepEqual((await getSavedWords()).find((record) => record.lemma === old.lemma)?.entry.chinese, ["新收藏"]);
  assert.equal(await updateSavedSnapshot(newer, { ...newer.entry, normalizedLemma: "wrong" }, "base", "new"), undefined);
});

test("a partial offline entry cannot erase the saved Chinese meaning", async () => {
  const old = await saveWord(result("offline-meaning", "已保存的释义"), "base");
  const refreshed = await refreshSavedSnapshots([old], {
    dataVersion: "base", searchDataVersion: "new", cancelled: () => false,
    load: async () => ({ lemma: old.lemma, normalizedLemma: old.lemma }),
    persist: updateSavedSnapshot,
  });
  assert.equal(refreshed.size, 0);
  const stored = (await getSavedWords()).find((record) => record.lemma === old.lemma);
  assert.deepEqual(stored?.entry.chinese, old.entry.chinese);
  assert.equal(stored?.searchDataVersion, "old");
});

test("large saved collections bound requests, skip current records and retry failed packs", async () => {
  const records: SavedRecord[] = Array.from({ length: 12 }, (_, index) => ({
    lemma: `word${index}`, entry: { lemma: `word${index}`, normalizedLemma: `word${index}` },
    savedAt: index, dataVersion: "base", searchDataVersion: index === 0 ? "new" : "old",
  }));
  let active = 0, maximum = 0;
  const loaded: string[] = [];
  const refreshed = await refreshSavedSnapshots(records, {
    dataVersion: "base", searchDataVersion: "new", cancelled: () => false,
    load: async (lemma) => {
      loaded.push(lemma); active++; maximum = Math.max(active, maximum);
      await new Promise<void>((resolve) => setTimeout(resolve, 1)); active--;
      if (lemma === "word1") throw new Error("offline");
      return { lemma, normalizedLemma: lemma, chinese: ["更新"] };
    },
    persist: async (previous, entry, dataVersion, searchDataVersion) => ({ ...previous, entry, dataVersion, searchDataVersion }),
  });
  assert.equal(maximum, 4);
  assert.ok(!loaded.includes("word0"));
  assert.ok(!refreshed.has("word1"));
  assert.equal(refreshed.size, 10);
  assert.equal(records[1].searchDataVersion, "old");
  let persisted = false;
  await refreshSavedSnapshots(records, { dataVersion: "base", searchDataVersion: "new",
    cancelled: () => true, load: async () => { throw new Error("cancelled work ran"); },
    persist: async () => { persisted = true; return undefined; } });
  assert.equal(persisted, false);
});
