import { DICTIONARY } from "./dictionary.ts";
import {
  countDictionaryShards,
  deleteDictionaryShardsExcept,
  getDictionaryMetadata,
  getDictionaryShard,
  putDictionaryShard,
  setDictionaryMetadata,
} from "./storage.ts";
import type {
  DictionaryEntry,
  DictionaryManifest,
  DictionaryShardDescriptor,
  OfflineInstallProgress,
  PackedDictionaryEntry,
  PartOfSpeech,
  StoredDictionaryShard,
} from "./types.ts";

type PackedMorphologyCandidate = [
  lemma: string,
  morphology?: string,
  partOfSpeech?: string,
];
type PackedMorphologyShard = Array<[
  surface: string,
  candidates: PackedMorphologyCandidate[],
]>;
type PackedLexiconShard = PackedDictionaryEntry[];
type PackedPrefixShard = Array<[key: string, lemmas: string[]]>;

const MANIFEST_URL = "/dictionary/manifest.json";
const MAX_MEMORY_BYTES = 8 * 1024 * 1024;

interface MemoryValue {
  value: unknown;
  bytes: number;
}

class ByteLru {
  private values = new Map<string, MemoryValue>();
  private totalBytes = 0;

  get<T>(key: string): T | undefined {
    const hit = this.values.get(key);
    if (!hit) return undefined;
    this.values.delete(key);
    this.values.set(key, hit);
    return hit.value as T;
  }

  set(key: string, value: unknown, bytes: number): void {
    const previous = this.values.get(key);
    if (previous) {
      this.totalBytes -= previous.bytes;
      this.values.delete(key);
    }
    this.values.set(key, { value, bytes });
    this.totalBytes += bytes;

    while (this.totalBytes > MAX_MEMORY_BYTES && this.values.size > 1) {
      const oldest = this.values.entries().next().value as
        | [string, MemoryValue]
        | undefined;
      if (!oldest) break;
      this.values.delete(oldest[0]);
      this.totalBytes -= oldest[1].bytes;
    }
  }
}

function stableValueKey(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function unpackEntry(record: PackedDictionaryEntry): DictionaryEntry {
  const isVerb = record.p?.includes("verb") ?? false;
  return {
    lemma: record.l,
    normalizedLemma: record.n,
    partOfSpeech: record.p,
    gender: record.g,
    // Older generated packs briefly exposed conjugated plural-person verb
    // forms through the nominal `plural` field. Ignore them at the schema
    // boundary so an already-open PWA never renders that misleading label
    // while a newer version installs.
    plural: isVerb ? undefined : record.pl,
    chinese: record.zh,
    spanish: record.es,
    definitions: record.d,
    examples: record.ex,
    forms: record.f,
    pronunciation: record.ipa,
    source: record.s,
    frequencyRank: record.r,
  };
}

function mergeUnique<T>(...lists: Array<T[] | undefined>): T[] | undefined {
  const seen = new Set<string>();
  const values = lists.flatMap((list) => list ?? []).filter((value) => {
    const key = stableValueKey(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return values.length ? values : undefined;
}

function mergeDefinitions(
  left: DictionaryEntry["definitions"],
  right: DictionaryEntry["definitions"],
): DictionaryEntry["definitions"] {
  if (!left && !right) return undefined;
  return {
    ca: mergeUnique(left?.ca, right?.ca),
    es: mergeUnique(left?.es, right?.es),
    zh: mergeUnique(left?.zh, right?.zh),
    en: mergeUnique(left?.en, right?.en),
  };
}

function mergeEntry(
  base: DictionaryEntry | undefined,
  overlay: DictionaryEntry | undefined,
): DictionaryEntry | undefined {
  if (!base) return overlay;
  if (!overlay) return base;
  return {
    ...base,
    lemma: base.lemma || overlay.lemma,
    normalizedLemma: base.normalizedLemma || overlay.normalizedLemma,
    partOfSpeech: mergeUnique(base.partOfSpeech, overlay.partOfSpeech),
    gender: base.gender ?? overlay.gender,
    plural: mergeUnique(base.plural, overlay.plural),
    chinese: mergeUnique(base.chinese, overlay.chinese),
    spanish: mergeUnique(base.spanish, overlay.spanish),
    definitions: mergeDefinitions(base.definitions, overlay.definitions),
    examples: mergeUnique(base.examples, overlay.examples)?.slice(0, 4),
    forms: mergeUnique(base.forms, overlay.forms)?.slice(0, 24),
    pronunciation: base.pronunciation ?? overlay.pronunciation,
    source: mergeUnique(base.source, overlay.source),
    frequencyRank: Math.min(
      base.frequencyRank ?? Number.MAX_SAFE_INTEGER,
      overlay.frequencyRank ?? Number.MAX_SAFE_INTEGER,
    ),
  };
}

function descriptorForKey(
  descriptors: DictionaryShardDescriptor[],
  key: string,
): DictionaryShardDescriptor | undefined {
  let low = 0;
  let high = descriptors.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const descriptor = descriptors[middle];
    if (key < descriptor.first) high = middle - 1;
    else if (key > descriptor.last) low = middle + 1;
    else return descriptor;
  }
  return undefined;
}

function descriptorsForPrefix(
  descriptors: DictionaryShardDescriptor[],
  prefix: string,
): DictionaryShardDescriptor[] {
  const upperBound = `${prefix}\uffff`;
  return descriptors.filter(
    (descriptor) => descriptor.last >= prefix && descriptor.first <= upperBound,
  );
}

function foldPrefixKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC");
}

async function decompressGzip(bytes: ArrayBuffer): Promise<string> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot decompress the local dictionary data.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function cloneArrayBuffer(bytes: ArrayBuffer): ArrayBuffer {
  return bytes.slice(0);
}

export class DictionaryRepository {
  private manifestPromise?: Promise<DictionaryManifest>;
  private memory = new ByteLru();
  private inFlight = new Map<string, Promise<unknown>>();
  private coreLexiconPromise?: Promise<Map<string, PackedDictionaryEntry>>;
  private coreMorphologyPromise?: Promise<Map<string, PackedMorphologyCandidate[]>>;

  private async compactCoreMode(manifest: DictionaryManifest): Promise<boolean> {
    if (typeof navigator === "undefined" || navigator.onLine !== false) {
      return false;
    }
    const fullReady = await getDictionaryMetadata<boolean>(
      `fullReady:${manifest.dataVersion}`,
    ).catch(() => false);
    return !fullReady;
  }

  async manifest(): Promise<DictionaryManifest> {
    if (!this.manifestPromise) {
      const request = fetch(MANIFEST_URL, { cache: "no-cache" })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Dictionary manifest: HTTP ${response.status}`);
          const manifest = (await response.json()) as DictionaryManifest;
          await setDictionaryMetadata("activeManifest", manifest).catch(() => undefined);
          void deleteDictionaryShardsExcept(manifest.dataVersion).catch(() => undefined);
          return manifest;
        })
        .catch(async (error) => {
          const stored = await getDictionaryMetadata<DictionaryManifest>("activeManifest").catch(
            () => undefined,
          );
          if (stored) return stored;
          throw error;
        });
      this.manifestPromise = request;
      void request.catch(() => {
        if (this.manifestPromise === request) this.manifestPromise = undefined;
      });
    }
    return this.manifestPromise;
  }

  private async loadJson<T>(
    kind: StoredDictionaryShard["kind"],
    descriptor: DictionaryShardDescriptor,
  ): Promise<T> {
    const manifest = await this.manifest();
    const key = `${manifest.dataVersion}:${kind}:${descriptor.id}`;
    const memoryHit = this.memory.get<T>(key);
    if (memoryHit) return memoryHit;

    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<T>;

    const loading = this.loadAndDecodeJson<T>(kind, descriptor, key);
    this.inFlight.set(key, loading);
    try {
      return await loading;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async loadAndDecodeJson<T>(
    kind: StoredDictionaryShard["kind"],
    descriptor: DictionaryShardDescriptor,
    key: string,
  ): Promise<T> {
    const manifest = await this.manifest();

    let compressed: ArrayBuffer | undefined;
    const stored = await getDictionaryShard(key).catch(() => undefined);
    if (stored) compressed = stored.data;

    if (!compressed) {
      const response = await fetch(descriptor.path, { cache: "force-cache" });
      if (!response.ok) throw new Error(`Dictionary shard: HTTP ${response.status}`);
      compressed = await response.arrayBuffer();
      const databaseBytes = cloneArrayBuffer(compressed);
      await putDictionaryShard({
        key,
        dataVersion: manifest.dataVersion,
        kind,
        shardId: descriptor.id,
        data: databaseBytes,
        bytes: compressed.byteLength,
        lastAccess: Date.now(),
      }).catch(() => undefined);
    }

    const text = await decompressGzip(compressed);
    const parsed = JSON.parse(text) as T;
    this.memory.set(key, parsed, text.length * 2);
    return parsed;
  }

  private async primeCompressed(
    kind: StoredDictionaryShard["kind"],
    descriptor: DictionaryShardDescriptor,
  ): Promise<void> {
    const manifest = await this.manifest();
    const key = `${manifest.dataVersion}:${kind}:${descriptor.id}`;
    if (await getDictionaryShard(key).catch(() => undefined)) return;
    const response = await fetch(descriptor.path, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Dictionary shard: HTTP ${response.status}`);
    const data = await response.arrayBuffer();
    await putDictionaryShard({
      key,
      dataVersion: manifest.dataVersion,
      kind,
      shardId: descriptor.id,
      data: cloneArrayBuffer(data),
      bytes: data.byteLength,
      lastAccess: Date.now(),
    });
  }

  private coreDescriptor(path: string, id: string): DictionaryShardDescriptor {
    return {
      id,
      path,
      first: "",
      last: "\uffff",
      entries: 0,
      bytes: 0,
    };
  }

  private async entryFromLayer(
    kind: Extract<
      StoredDictionaryShard["kind"],
      "lex" | "freedict" | "wiktionary" | "curated"
    >,
    descriptors: DictionaryShardDescriptor[] | undefined,
    normalizedLemma: string,
  ): Promise<DictionaryEntry | undefined> {
    if (!descriptors?.length) return undefined;
    const descriptor = descriptorForKey(descriptors, normalizedLemma);
    if (!descriptor) return undefined;
    const records = await this.loadJson<PackedLexiconShard>(kind, descriptor).catch(
      () => undefined,
    );
    if (!records) return undefined;
    const record = records.find((item) => item.n === normalizedLemma);
    return record ? unpackEntry(record) : undefined;
  }

  private async coreLexicon(): Promise<Map<string, PackedDictionaryEntry>> {
    if (!this.coreLexiconPromise) {
      const request = this.manifest().then(async (manifest) => {
        const descriptor =
          manifest.coreDescriptors?.lex ??
          this.coreDescriptor(manifest.core.lex, "lex");
        const records = await this.loadJson<PackedLexiconShard>(
          "core",
          descriptor,
        );
        return new Map(records.map((record) => [record.n, record]));
      });
      this.coreLexiconPromise = request;
      void request.catch(() => {
        if (this.coreLexiconPromise === request) this.coreLexiconPromise = undefined;
      });
    }
    return this.coreLexiconPromise;
  }

  private async coreMorphology(): Promise<
    Map<string, PackedMorphologyCandidate[]>
  > {
    if (!this.coreMorphologyPromise) {
      const request = this.manifest().then(async (manifest) => {
        const descriptor =
          manifest.coreDescriptors?.morph ??
          this.coreDescriptor(manifest.core.morph, "morph");
        const records = await this.loadJson<PackedMorphologyShard>(
          "core",
          descriptor,
        );
        return new Map(records);
      });
      this.coreMorphologyPromise = request;
      void request.catch(() => {
        if (this.coreMorphologyPromise === request) {
          this.coreMorphologyPromise = undefined;
        }
      });
    }
    return this.coreMorphologyPromise;
  }

  async getEntry(normalizedLemma: string): Promise<DictionaryEntry | undefined> {
    const curated = DICTIONARY[normalizedLemma];
    let manifest: DictionaryManifest;
    try {
      manifest = await this.manifest();
    } catch (error) {
      if (curated) return curated;
      throw error;
    }
    if (await this.compactCoreMode(manifest)) {
      const coreRecord = (await this.coreLexicon()).get(normalizedLemma);
      return coreRecord ? mergeEntry(curated, unpackEntry(coreRecord)) : curated;
    }
    const [base, freedict, wiktionary, curatedPack] = await Promise.all([
      this.entryFromLayer("lex", manifest.lex, normalizedLemma),
      this.entryFromLayer(
        "freedict",
        manifest.enrichment?.freedict,
        normalizedLemma,
      ),
      this.entryFromLayer(
        "wiktionary",
        manifest.enrichment?.wiktionary,
        normalizedLemma,
      ),
      this.entryFromLayer(
        "curated",
        manifest.enrichment?.curated,
        normalizedLemma,
      ),
    ]);
    const merged = mergeEntry(
      curated,
      mergeEntry(curatedPack, mergeEntry(base, mergeEntry(freedict, wiktionary))),
    );
    if (merged) return merged;

    // Fresh offline installs have the compact core pack, not every extended
    // range shard. Decode it only after the small range lookup cannot run.
    const coreRecord = (await this.coreLexicon()).get(normalizedLemma);
    return coreRecord ? unpackEntry(coreRecord) : undefined;
  }

  async morphology(
    normalizedSurface: string,
    includeCoreFallback = true,
  ): Promise<PackedMorphologyCandidate[]> {
    const manifest = await this.manifest();
    if (includeCoreFallback && (await this.compactCoreMode(manifest))) {
      const coreCandidates = (await this.coreMorphology()).get(normalizedSurface);
      return coreCandidates ?? [];
    }
    const descriptor = descriptorForKey(manifest.morph, normalizedSurface);
    const base = descriptor
      ? (
          await this.loadJson<PackedMorphologyShard>("morph", descriptor).catch(
            () => [] as PackedMorphologyShard,
          )
        ).find(([surface]) => surface === normalizedSurface)?.[1] ?? []
      : [];
    const wikiDescriptor = descriptorForKey(
      manifest.enrichment?.wiktionaryMorph ?? [],
      normalizedSurface,
    );
    const wiktionary = wikiDescriptor
      ? (
          await this.loadJson<PackedMorphologyShard>(
            "wiktionaryMorph",
            wikiDescriptor,
          ).catch(() => [] as PackedMorphologyShard)
        ).find(([surface]) => surface === normalizedSurface)?.[1] ?? []
      : [];
    const seen = new Set<string>();
    const combined = [...base, ...wiktionary].filter((candidate) => {
      const key = candidate.join("\u0000");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (combined.length) return combined;
    if (!includeCoreFallback) return [];
    return (await this.coreMorphology()).get(normalizedSurface) ?? [];
  }

  async prefix(normalizedPrefix: string, limit = 8): Promise<string[]> {
    const manifest = await this.manifest();
    const indexPrefix = foldPrefixKey(normalizedPrefix);
    if (await this.compactCoreMode(manifest)) {
      const matches = (await this.coreEntries())
        .filter((entry) => foldPrefixKey(entry.normalizedLemma).startsWith(indexPrefix))
        .sort(
          (left, right) =>
            (left.frequencyRank ?? Number.MAX_SAFE_INTEGER) -
              (right.frequencyRank ?? Number.MAX_SAFE_INTEGER) ||
            left.lemma.localeCompare(right.lemma, "ca"),
        )
        .slice(0, limit)
        .map((entry) => entry.lemma);
      return matches;
    }
    const layers: Array<[
      Extract<
        StoredDictionaryShard["kind"],
        "prefix" | "freedictPrefix" | "wiktionaryPrefix"
        | "curatedPrefix"
      >,
      DictionaryShardDescriptor[] | undefined,
    ]> = [
      ["prefix", manifest.prefix],
      ["freedictPrefix", manifest.enrichment?.freedictPrefix],
      ["wiktionaryPrefix", manifest.enrichment?.wiktionaryPrefix],
      ["curatedPrefix", manifest.enrichment?.curatedPrefix],
    ];
    const matches: string[] = [];
    for (const [kind, descriptors] of layers) {
      if (matches.length >= limit * 3) break;
      for (const descriptor of descriptorsForPrefix(descriptors ?? [], indexPrefix)) {
        const rows = await this.loadJson<PackedPrefixShard>(kind, descriptor).catch(
          () => undefined,
        );
        if (!rows) continue;
        for (const [key, lemmas] of rows) {
          if (key.startsWith(indexPrefix)) matches.push(...lemmas);
          if (matches.length >= limit * 3) break;
        }
        if (matches.length >= limit * 3) break;
      }
    }
    return [...new Set(matches)].slice(0, limit);
  }

  async coreEntries(): Promise<DictionaryEntry[]> {
    return [...(await this.coreLexicon()).values()].map(unpackEntry);
  }

  async ensureCoreOffline(): Promise<void> {
    const manifest = await this.manifest();
    const lex =
      manifest.coreDescriptors?.lex ?? this.coreDescriptor(manifest.core.lex, "lex");
    const morph =
      manifest.coreDescriptors?.morph ??
      this.coreDescriptor(manifest.core.morph, "morph");
    await Promise.all([
      this.primeCompressed("core", lex),
      this.primeCompressed("core", morph),
    ]);
    await setDictionaryMetadata(`coreReady:${manifest.dataVersion}`, true).catch(
      () => undefined,
    );
  }

  private offlineDescriptors(
    manifest: DictionaryManifest,
  ): Array<readonly [StoredDictionaryShard["kind"], DictionaryShardDescriptor]> {
    const coreLex =
      manifest.coreDescriptors?.lex ?? this.coreDescriptor(manifest.core.lex, "lex");
    const coreMorph =
      manifest.coreDescriptors?.morph ?? this.coreDescriptor(manifest.core.morph, "morph");
    return [
      ["core", coreLex] as const,
      ["core", coreMorph] as const,
      ...manifest.lex.map((descriptor) => ["lex", descriptor] as const),
      ...manifest.morph.map((descriptor) => ["morph", descriptor] as const),
      ...manifest.prefix.map((descriptor) => ["prefix", descriptor] as const),
      ...(manifest.enrichment?.freedict ?? []).map(
        (descriptor) => ["freedict", descriptor] as const,
      ),
      ...(manifest.enrichment?.wiktionary ?? []).map(
        (descriptor) => ["wiktionary", descriptor] as const,
      ),
      ...(manifest.enrichment?.curated ?? []).map(
        (descriptor) => ["curated", descriptor] as const,
      ),
      ...(manifest.enrichment?.wiktionaryMorph ?? []).map(
        (descriptor) => ["wiktionaryMorph", descriptor] as const,
      ),
      ...(manifest.enrichment?.freedictPrefix ?? []).map(
        (descriptor) => ["freedictPrefix", descriptor] as const,
      ),
      ...(manifest.enrichment?.wiktionaryPrefix ?? []).map(
        (descriptor) => ["wiktionaryPrefix", descriptor] as const,
      ),
      ...(manifest.enrichment?.curatedPrefix ?? []).map(
        (descriptor) => ["curatedPrefix", descriptor] as const,
      ),
    ];
  }

  async installedOfflineProgress(): Promise<OfflineInstallProgress | undefined> {
    const manifest = await this.manifest();
    const descriptors = this.offlineDescriptors(manifest);
    const completed = await countDictionaryShards(manifest.dataVersion).catch(() => 0);
    if (completed < descriptors.length) return undefined;
    const totalBytes = descriptors.reduce(
      (sum, [, descriptor]) => sum + descriptor.bytes,
      0,
    );
    return {
      completed: descriptors.length,
      total: descriptors.length,
      downloadedBytes: totalBytes,
      totalBytes,
      ready: true,
    };
  }

  async installFullOffline(
    onProgress?: (progress: OfflineInstallProgress) => void,
  ): Promise<OfflineInstallProgress> {
    const manifest = await this.manifest();
    const descriptors = this.offlineDescriptors(manifest);
    const totalBytes = descriptors.reduce((sum, [, descriptor]) => sum + descriptor.bytes, 0);
    let completed = 0;
    let downloadedBytes = 0;

    for (const [kind, descriptor] of descriptors) {
      // Store gzip blobs directly. Parsing every shard here would temporarily
      // allocate the whole 140 MB raw dictionary and jank mobile Safari.
      await this.primeCompressed(kind, descriptor);
      completed += 1;
      downloadedBytes += descriptor.bytes;
      const progress = {
        completed,
        total: descriptors.length,
        downloadedBytes,
        totalBytes,
        ready: completed === descriptors.length,
      };
      onProgress?.(progress);
      // Yield so iPhone Safari can keep rendering progress and accepting input.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const finalProgress = {
      completed,
      total: descriptors.length,
      downloadedBytes,
      totalBytes,
      ready: true,
    };
    await setDictionaryMetadata(`fullReady:${manifest.dataVersion}`, true).catch(
      () => undefined,
    );
    return finalProgress;
  }
}

export const dictionaryRepository = new DictionaryRepository();

export function isVerb(entry: DictionaryEntry | undefined): boolean {
  return entry?.partOfSpeech?.includes("verb" as PartOfSpeech) ?? false;
}

