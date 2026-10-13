import reviewedBatch from "../data/translations/batches/zh-pilot-0001.reviewed.json" with { type: "json" };
import secondBatch from "../data/translations/batches/zh-pilot-0002.reviewed.json" with { type: "json" };
import thirdBatch from "../data/translations/batches/zh-pilot-0003.reviewed.json" with { type: "json" };
import fourthBatch from "../data/translations/batches/zh-pilot-0004.reviewed.json" with { type: "json" };
import type { DictionaryEntry } from "./types.ts";

// The small pilot ships with the app so its translations also reach compact
// offline lookups and old saved snapshots. Full-corpus enrichment belongs in
// versioned shards rather than an ever-growing JavaScript bundle.
const translations = new Map(
  [reviewedBatch, secondBatch, thirdBatch, fourthBatch].flatMap((batch) => batch.records
    .filter((record) => record.status === "translated")
    .map((record) => [record.normalizedLemma, { ...record, batchId: batch.batchId }] as const)),
);

export function enrichChinese(entry: DictionaryEntry): DictionaryEntry {
  // Keep existing authored or upstream Chinese ahead of the pilot drafts.
  if (entry.chinese?.some((text) => text.trim()) ||
      entry.definitions?.zh?.some((text) => text.trim())) return entry;

  const translation = translations.get(entry.normalizedLemma);
  if (!translation) return entry;

  return {
    ...entry,
    chinese: [...new Set(translation.senses.map((sense) => sense.translationZh))],
    source: [...new Set([...(entry.source ?? []), translation.batchId])],
    provenance: [
      ...(entry.provenance ?? []),
      {
        sourceId: translation.batchId,
        sourceEntryId: translation.id,
        fields: ["chinese"],
      },
    ],
  };
}
