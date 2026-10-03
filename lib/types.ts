export type PartOfSpeech =
  | "verb"
  | "noun"
  | "proper noun"
  | "adjective"
  | "adverb"
  | "article"
  | "conjunction"
  | "contraction"
  | "determiner"
  | "expression"
  | "interjection"
  | "numeral"
  | "particle"
  | "preposition"
  | "pronoun"
  | "other";

export type GrammaticalGender = "masculine" | "feminine" | "common";

export interface DictionaryExample {
  ca: string;
  es?: string;
  zh?: string;
  en?: string;
  source?: string;
}

export interface DictionaryDefinitions {
  ca?: string[];
  es?: string[];
  zh?: string[];
  /** English Wiktionary glosses are retained as a labelled fallback only. */
  en?: string[];
}

export interface EntryProvenance {
  sourceId: string;
  sourceEntryId?: string;
  fields?: string[];
}

/**
 * Canonical, lemma-centred schema shared by curated and generated records.
 * Full form-to-lemma analyses live in separate morphology shards; `forms` is
 * intentionally limited to representative display forms.
 */
export interface DictionaryEntry {
  lemma: string;
  normalizedLemma: string;
  partOfSpeech?: PartOfSpeech[];
  gender?: GrammaticalGender;
  plural?: string[];
  chinese?: string[];
  spanish?: string[];
  definitions?: DictionaryDefinitions;
  examples?: DictionaryExample[];
  forms?: string[];
  conjugation?: Record<string, unknown>;
  pronunciation?: string;
  source?: string[];
  provenance?: EntryProvenance[];
  frequencyRank?: number;
}

/** Compact transport record used in generated static shards. */
export interface PackedDictionaryEntry {
  l: string;
  n: string;
  p?: PartOfSpeech[];
  g?: GrammaticalGender;
  pl?: string[];
  zh?: string[];
  es?: string[];
  d?: DictionaryDefinitions;
  ex?: DictionaryExample[];
  f?: string[];
  ipa?: string;
  s?: string[];
  r?: number;
}

export interface LemmaResult {
  input: string;
  lemma: string;
  partOfSpeech?: string;
  morphology?: string;
  confidence?: number;
  entry?: DictionaryEntry;
}

export type ResolutionSource =
  | "exact"
  | "normalized-exact"
  | "morphology"
  | "clitic"
  | "accent-fallback";

export interface FoundLookup {
  status: "found";
  searchedForm: string;
  normalizedQuery: string;
  lemma: string;
  morphology?: string;
  confidence: number;
  resolutionSource: ResolutionSource;
  entry: DictionaryEntry;
  candidates: LemmaResult[];
}

export interface MissedLookup {
  status: "not-found";
  searchedForm: string;
  normalizedQuery: string;
  resolutionSource: "prefix" | "fuzzy" | "none";
  suggestions: string[];
}

export type LookupResponse = FoundLookup | MissedLookup;

export interface HistoryRecord {
  query: string;
  normalizedQuery: string;
  lemma: string;
  meaning: string;
  timestamp: number;
}

export interface SavedRecord {
  lemma: string;
  entry: DictionaryEntry;
  savedAt: number;
  dataVersion?: string;
}

export interface CacheRecord {
  query: string;
  lemma: string;
  result: FoundLookup;
  cachedAt: number;
  dataVersion?: string;
}

export interface DictionaryShardDescriptor {
  id: string;
  path: string;
  first: string;
  last: string;
  entries: number;
  bytes: number;
  sha256?: string;
}

export interface DictionaryManifest {
  schemaVersion: number;
  dataVersion: string;
  generatedAt: string;
  lemmaCount: number;
  baseLemmaCount?: number;
  morphologyFormCount: number;
  morphologyAnalysisCount?: number;
  baseMorphologyAnalysisCount?: number;
  baseMorphologyFormCount?: number;
  coreLemmaCount: number;
  coreFormCount: number;
  lex: DictionaryShardDescriptor[];
  morph: DictionaryShardDescriptor[];
  prefix: DictionaryShardDescriptor[];
  enrichment?: {
    freedict?: DictionaryShardDescriptor[];
    wiktionary?: DictionaryShardDescriptor[];
    curated?: DictionaryShardDescriptor[];
    wiktionaryMorph?: DictionaryShardDescriptor[];
    freedictPrefix?: DictionaryShardDescriptor[];
    wiktionaryPrefix?: DictionaryShardDescriptor[];
    curatedPrefix?: DictionaryShardDescriptor[];
  };
  core: {
    lex: string;
    morph: string;
  };
  coreDescriptors?: {
    lex: DictionaryShardDescriptor;
    morph: DictionaryShardDescriptor;
  };
  sources: Array<{
    id: string;
    name: string;
    license: string;
    url: string;
  }>;
  sizes: {
    rawBytes: number;
    gzipBytes?: number;
    compressedBytes?: number;
    initialRawBytes: number;
    initialGzipBytes?: number;
    coreRawBytes?: number;
    coreCompressedBytes?: number;
    sourceBytes?: number;
  };
}

export interface StoredDictionaryShard {
  key: string;
  dataVersion: string;
  kind:
    | "core"
    | "lex"
    | "morph"
    | "prefix"
    | "freedict"
    | "wiktionary"
    | "curated"
    | "wiktionaryMorph"
    | "freedictPrefix"
    | "wiktionaryPrefix"
    | "curatedPrefix";
  shardId: string;
  /** Gzip-compressed static asset bytes, kept compressed in IndexedDB. */
  data: ArrayBuffer;
  bytes: number;
  lastAccess: number;
}

export interface OfflineInstallProgress {
  completed: number;
  total: number;
  downloadedBytes: number;
  totalBytes: number;
  ready: boolean;
}

export function primaryChinese(entry: DictionaryEntry): string {
  return entry.chinese?.join("；") || entry.definitions?.zh?.join("；") || "";
}

export function primarySpanish(entry: DictionaryEntry): string {
  return entry.spanish?.join("；") || entry.definitions?.es?.join("；") || "";
}

