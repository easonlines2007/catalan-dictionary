import type { DictionaryEntry, SavedRecord } from "./types.ts";
import { primaryChinese } from "./types.ts";

type RefreshOptions = {
  dataVersion: string;
  searchDataVersion: string;
  load: (lemma: string) => Promise<DictionaryEntry | undefined>;
  persist: (previous: SavedRecord, entry: DictionaryEntry, dataVersion: string, searchDataVersion: string) => Promise<SavedRecord | undefined>;
  cancelled: () => boolean;
};

/** Keep startup responsive even for a large collection or slow/offline packs. */
export async function refreshSavedSnapshots(records: SavedRecord[], options: RefreshOptions): Promise<Map<string, SavedRecord>> {
  const refreshed = new Map<string, SavedRecord>();
  const pending = records.filter((record) => record.dataVersion !== options.dataVersion
    || record.searchDataVersion !== options.searchDataVersion);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (cursor < pending.length && !options.cancelled()) {
      const previous = pending[cursor++];
      try {
        const entry = await options.load(previous.entry.normalizedLemma);
        if (!entry || options.cancelled()) continue;
        // A repository may return a base record when an optional overlay
        // fails offline. Do not erase a usable saved meaning or mark it fresh.
        if (primaryChinese(previous.entry) && !primaryChinese(entry)) continue;
        const updated = await options.persist(previous, entry, options.dataVersion, options.searchDataVersion);
        if (updated) refreshed.set(previous.lemma, updated);
      } catch {
        // Failed downloads retain the original snapshot and retry next startup.
      }
    }
  }));
  return refreshed;
}
