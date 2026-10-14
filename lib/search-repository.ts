import {
  getDictionaryMetadata, getDictionaryShard, putDictionaryShard, setDictionaryMetadata,
} from "./storage.ts";
import { normalizeSearchInput, normalizeSearchKey } from "./search-normalization.ts";
import { chineseMatchingKey } from "./chinese-search.ts";
import { matchSuggestions } from "./search-suggestions.ts";
import { semanticRows } from "./chinese-semantic.ts";
import type { ChineseSemanticRow } from "./chinese-semantic.ts";
import type { SuggestionRow } from "./search-suggestions.ts";
import type {
  PackedDictionaryEntry, SearchManifest, SearchShardDescriptor, SearchSuggestion,
  SemanticMatch,
} from "./types.ts";

type Posting = [lemma: string, term: string, kind: "translation" | "alias", priority?: number];
type ReverseIndex = Array<[key: string, postings: Posting[]]>;
class MissingSearchShard extends Error {}
export interface ReverseMatch {
  normalizedLemma: string;
  matchedTerm: string;
  matchKind: "translation" | "alias" | "semantic";
  matchedLanguage: "es" | "zh";
  exact: boolean;
  priority?: number;
  semanticMatch?: SemanticMatch;
}

function descriptorForKey<T extends { first: string; last: string }>(descriptors: T[], key: string): T | undefined {
  // The builder uses UTF-16 ordinal ordering. Locale-aware ordering would
  // select the wrong range for accents and Chinese characters.
  return descriptors.find((descriptor) => descriptor.first <= key && descriptor.last >= key);
}

export class SearchRepository {
  private manifestPromise?: Promise<SearchManifest>;
  private memory = new Map<string, { value: unknown; bytes: number }>();
  private memoryBytes = 0;
  private inFlight = new Map<string, Promise<unknown>>();
  private catalogues = new Map<string, Promise<SuggestionRow[]>>();

  async manifest(expectedBaseVersion?: string): Promise<SearchManifest> {
    if (!this.manifestPromise) {
      const request = fetch("/dictionary/search/manifest.json", { cache: "no-cache" })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Search manifest: HTTP ${response.status}`);
          const manifest = await response.json() as SearchManifest;
          if (manifest.schemaVersion !== 1 || !manifest.baseDataVersion || !manifest.core?.entries) {
            throw new Error("Unsupported search manifest");
          }
          if (expectedBaseVersion && manifest.baseDataVersion !== expectedBaseVersion) {
            throw new Error("Search data and dictionary versions differ. Reconnect to update.");
          }
          await setDictionaryMetadata("activeSearchManifest", manifest).catch(() => undefined);
          return manifest;
        }).catch(async (error) => {
          const stored = await getDictionaryMetadata<SearchManifest>("activeSearchManifest").catch(() => undefined);
          if (stored?.schemaVersion === 1 &&
              (!expectedBaseVersion || stored.baseDataVersion === expectedBaseVersion)) return stored;
          throw error;
        });
      this.manifestPromise = request;
      void request.catch(() => {
        if (this.manifestPromise === request) this.manifestPromise = undefined;
      });
    }
    const manifest = await this.manifestPromise;
    if (expectedBaseVersion && manifest.baseDataVersion !== expectedBaseVersion) {
      this.manifestPromise = undefined;
      throw new Error("Search data and dictionary versions differ. Reconnect to update.");
    }
    return manifest;
  }

  /** A tab can outlive a deployment. Refresh once when immutable packs retire. */
  private async withManifest<T>(baseVersion: string, action: (manifest: SearchManifest) => Promise<T>): Promise<T> {
    const manifest = await this.manifest(baseVersion);
    const request = this.manifestPromise;
    try { return await action(manifest); }
    catch (error) {
      if (!(error instanceof MissingSearchShard) || (typeof navigator !== "undefined" && navigator.onLine === false)) throw error;
      // Concurrent misses share the refresh; an older request cannot discard
      // the newer manifest that another lookup has already installed.
      if (this.manifestPromise === request) this.manifestPromise = undefined;
      const latest = await this.manifest(baseVersion);
      if (latest.dataVersion === manifest.dataVersion) throw error;
      return action(latest);
    }
  }

  storageKey(manifest: SearchManifest, descriptor: SearchShardDescriptor): string {
    return `${manifest.baseDataVersion}:search:${manifest.dataVersion}:${descriptor.kind}:${descriptor.id}`;
  }

  private async compressed(manifest: SearchManifest, descriptor: SearchShardDescriptor, requireStorage = false): Promise<ArrayBuffer> {
    const key = this.storageKey(manifest, descriptor);
    const stored = await getDictionaryShard(key).catch(() => undefined);
    if (stored) return stored.data;
    const response = await fetch(descriptor.path, { cache: "force-cache" });
    if (response.status === 404 || response.status === 410) throw new MissingSearchShard(`Search shard retired: HTTP ${response.status}`);
    if (!response.ok) throw new Error(`Search shard: HTTP ${response.status}`);
    const data = await response.arrayBuffer();
    if (descriptor.sha256 && globalThis.crypto?.subtle) {
      const hash = await crypto.subtle.digest("SHA-256", data);
      const actual = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (actual !== descriptor.sha256) throw new Error("Search shard checksum mismatch");
    }
    const storing = putDictionaryShard({
      key, dataVersion: manifest.baseDataVersion, kind: descriptor.kind,
      shardId: `${manifest.dataVersion}:${descriptor.id}`, data: data.slice(0),
      bytes: data.byteLength, lastAccess: Date.now(),
    });
    if (requireStorage) await storing;
    else await storing.catch(() => undefined);
    return data;
  }

  private async load<T>(manifest: SearchManifest, descriptor: SearchShardDescriptor): Promise<T> {
    const key = this.storageKey(manifest, descriptor);
    const memory = this.memory.get(key);
    if (memory) {
      this.memory.delete(key);
      this.memory.set(key, memory);
      return memory.value as T;
    }
    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<T>;
    const request = (async () => {
      const data = await this.compressed(manifest, descriptor);
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
      const text = await new Response(stream).text();
      const value = JSON.parse(text) as T;
      const bytes = text.length * 2;
      this.memory.set(key, { value, bytes });
      this.memoryBytes += bytes;
      while (this.memoryBytes > 8 * 1024 * 1024 && this.memory.size > 1) {
        const oldest = this.memory.entries().next().value!;
        this.memory.delete(oldest[0]);
        this.memoryBytes -= oldest[1].bytes;
      }
      return value;
    })();
    this.inFlight.set(key, request);
    try { return await request; }
    finally { this.inFlight.delete(key); }
  }

  async coreEntry(lemma: string, baseVersion: string): Promise<PackedDictionaryEntry | undefined> {
    return this.withManifest(baseVersion, async (manifest) => {
      const rows = await this.load<PackedDictionaryEntry[]>(manifest, manifest.core.entries);
      return rows.find((row) => row.n === lemma);
    });
  }

  async chineseEntry(lemma: string, baseVersion: string): Promise<PackedDictionaryEntry | undefined> {
    return this.withManifest(baseVersion, async (manifest) => {
      const descriptor = descriptorForKey(manifest.chinese, lemma);
      if (!descriptor) return undefined;
      return (await this.load<PackedDictionaryEntry[]>(manifest, descriptor)).find((row) => row.n === lemma);
    });
  }

  async isOfflineLimited(manifest?: SearchManifest): Promise<boolean> {
    if (typeof navigator === "undefined" || navigator.onLine !== false) return false;
    const active = manifest ?? await this.manifest();
    return !await getDictionaryMetadata<boolean>(`searchFullReady:${active.dataVersion}`).catch(() => false);
  }

  async reverse(query: string, language: "es" | "zh", baseVersion: string, limit = 32): Promise<ReverseMatch[]> {
    return this.withManifest(baseVersion, async (manifest) => {
      const key = normalizeSearchKey(query, language);
      const limited = await this.isOfflineLimited(manifest);
      const keys = language === "zh" ? [...new Set([key, chineseMatchingKey(key)])] : [key];
      let postings: Posting[] = [];
      for (const candidate of keys) {
        const descriptor = limited ? manifest.core[language] : descriptorForKey(manifest.indexes[language], candidate);
        if (!descriptor) continue;
        const index = await this.load<ReverseIndex>(manifest, descriptor);
        postings = index.find(([term]) => term === candidate)?.[1] ?? [];
        if (postings.length) break;
      }
      const exactQuery = normalizeSearchInput(query, language);
      const chineseQuery = language === "zh" ? chineseMatchingKey(query) : undefined;
      // Preserve the index's frequency ordering within each spelling group.
      return postings.map(([normalizedLemma, matchedTerm, matchKind, priority]) => ({
        normalizedLemma, matchedTerm, matchKind, matchedLanguage: language,
        priority,
        exact: normalizeSearchInput(matchedTerm, language) === exactQuery
          || (chineseQuery !== undefined && chineseMatchingKey(matchedTerm) === chineseQuery),
      })).sort((a, b) => Number(b.exact) - Number(a.exact) || (b.priority ?? 0) - (a.priority ?? 0)).slice(0, limit);
    });
  }

  async semantic(query: string, baseVersion: string, limit = 32): Promise<ReverseMatch[]> {
    if (!query.trim() || Array.from(query).length > 64 || limit <= 0) return [];
    return this.withManifest(baseVersion, async (manifest) => {
      if (!manifest.semantic) return [];
      const limited = await this.isOfflineLimited(manifest);
      const descriptor = limited ? manifest.semantic.core : manifest.semantic.zh;
      let rows: ChineseSemanticRow[];
      try { rows = await this.load<ChineseSemanticRow[]>(manifest, descriptor); }
      catch (error) {
        if (limited || error instanceof MissingSearchShard) throw error;
        rows = await this.load<ChineseSemanticRow[]>(manifest, manifest.semantic.core);
      }
      return semanticRows(rows, query, limit).map(([, expression, normalizedLemma, matchedTerm, , conceptId]) => ({
        normalizedLemma, matchedTerm, matchKind: "semantic", matchedLanguage: "zh", exact: false,
        semanticMatch: { conceptId, expression },
      }));
    });
  }

  async suggest(query: string, language: "es" | "zh", baseVersion: string, limit = 8, signal?: AbortSignal): Promise<SearchSuggestion[]> {
    const key = normalizeSearchKey(query, language);
    if (!key || (language === "es" && key.length < 2) || Array.from(key).length > 64 || signal?.aborted) return [];
    return this.withManifest(baseVersion, async (manifest) => {
      const limited = await this.isOfflineLimited(manifest);
      const descriptor = limited ? undefined : manifest.suggestions?.[language];
      const cacheKey = `${manifest.dataVersion}:${language}:${descriptor ? "full" : "core"}`;
      let catalogue = this.catalogues.get(cacheKey);
      if (!catalogue) {
        catalogue = descriptor
          ? this.load<SuggestionRow[]>(manifest, descriptor)
          : Promise.all([
            this.load<ReverseIndex>(manifest, manifest.core[language]),
            this.load<PackedDictionaryEntry[]>(manifest, manifest.core.entries),
          ]).then(([index, entries]) => {
            const byLemma = new Map(entries.map((entry) => [entry.n, entry]));
            return index.map(([term, postings]): SuggestionRow => {
              const [lemma, display] = postings[0];
              const entry = byLemma.get(lemma);
              return [term, language === "zh" ? term : display, entry?.l ?? lemma, entry?.r ?? Number.MAX_SAFE_INTEGER];
            });
          });
        this.catalogues.set(cacheKey, catalogue);
        void catalogue.catch(() => this.catalogues.delete(cacheKey));
      }
      try {
        return await matchSuggestions(await catalogue, query, language, limit, signal);
      } catch (error) {
        if (error instanceof MissingSearchShard) throw error;
        // A failed extended download can still offer the installed core terms.
        if (!descriptor) throw error;
        const rows = await this.load<ReverseIndex>(manifest, manifest.core[language]);
        return matchSuggestions(rows.map(([term, postings]) => [term,
          language === "zh" ? term : postings[0][1], postings[0][0], Number.MAX_SAFE_INTEGER]), query, language, limit, signal);
      }
    });
  }

  async ensureCoreOffline(baseVersion: string): Promise<void> {
    return this.withManifest(baseVersion, async (manifest) => {
      await Promise.all(manifest.offline.core.map((descriptor) => this.prime(manifest, descriptor)));
      await setDictionaryMetadata(`searchCoreReady:${manifest.dataVersion}`, true);
    });
  }

  async prime(manifest: SearchManifest, descriptor: SearchShardDescriptor): Promise<void> {
    try { await this.compressed(manifest, descriptor, true); }
    catch (error) {
      if (error instanceof MissingSearchShard) {
        const active = this.manifestPromise;
        if (active && await active.catch(() => undefined) === manifest && this.manifestPromise === active) this.manifestPromise = undefined;
      }
      throw error;
    }
  }
}

export const searchRepository = new SearchRepository();
