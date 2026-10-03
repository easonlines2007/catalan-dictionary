import { dictionaryRepository, isVerb } from "./dictionary-repository.ts";
import { FORM_INDEX } from "./dictionary.ts";
import type {
  DictionaryEntry,
  LemmaResult,
  LookupResponse,
} from "./types.ts";

export function normalizeCatalanInput(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("ca-ES")
    .replace(/[’‘ʼ＇`´]/g, "'")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\u0140l/g, "l·l")
    .replace(/l[•∙⋅‧]l/g, "l·l")
    .replace(/\s+/g, " ");
}

export function foldCatalanForFallback(value: string): string {
  return normalizeCatalanInput(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC");
}

function isSearchable(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

function morphologyLabelPriority(label: string | undefined): number {
  const value = label?.toLowerCase() ?? "";
  if (
    value.includes("present") &&
    value.includes("indicative") &&
    value.includes("first person")
  ) {
    return 0;
  }
  if (value.includes("present") && value.includes("indicative")) return 1;
  if (value.includes("present") && value.includes("subjunctive")) return 2;
  if (value.includes("imperative")) return 3;
  return value ? 4 : 5;
}

async function hydrateCandidates(
  input: string,
  candidates: Array<[string, string?, string?]>,
): Promise<LemmaResult[]> {
  const deduplicated = new Map<string, LemmaResult>();
  const hydrated = await Promise.all(
    candidates.map(async ([lemma, morphology, partOfSpeech]) => {
      if (!lemma) return undefined;
      const entry = await dictionaryRepository.getEntry(
        normalizeCatalanInput(lemma),
      );
      if (!entry) return undefined;
      return {
        input,
        lemma: entry.lemma,
        morphology,
        partOfSpeech: partOfSpeech || entry.partOfSpeech?.[0],
        confidence: 0.98,
        entry,
      } satisfies LemmaResult;
    }),
  );
  for (const result of hydrated) {
    if (!result) continue;
    const key = result.entry!.normalizedLemma;
    const previous = deduplicated.get(key);
    if (
      !previous ||
      morphologyLabelPriority(result.morphology) <
        morphologyLabelPriority(previous.morphology)
    ) {
      deduplicated.set(key, result);
    }
  }

  return [...deduplicated.values()].sort((left, right) => {
    const leftRank = left.entry?.frequencyRank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = right.entry?.frequencyRank ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || left.lemma.localeCompare(right.lemma, "ca");
  }).map((candidate, index) => ({
    ...candidate,
    confidence: Math.max(0.9, 0.98 - index * 0.01),
  }));
}

const CLITIC_SUFFIXES = [
  "-me'n",
  "-te'n",
  "-se'n",
  "-m'ho",
  "-t'ho",
  "-n'hi",
  "-nos",
  "-vos",
  "-los",
  "-les",
  "-me",
  "-te",
  "-se",
  "-lo",
  "-la",
  "-li",
  "-ho",
  "-hi",
  "-ne",
  "'m",
  "'t",
  "'s",
  "'l",
  "'ls",
  "'n",
  "'ho",
  "'hi",
] as const;

async function resolveClitic(input: string): Promise<LemmaResult[]> {
  const suffix = CLITIC_SUFFIXES.find((item) => input.endsWith(item));
  if (!suffix) return [];
  const host = input.slice(0, -suffix.length);
  if (!host || !isSearchable(host)) return [];

  const exactHost = await dictionaryRepository.getEntry(host);
  if (isVerb(exactHost)) {
    const verbEntry = exactHost as DictionaryEntry;
    return [
      {
        input,
        lemma: verbEntry.lemma,
        partOfSpeech: "verb",
        morphology: `verb + clitic ${suffix.replace(/^[-']/u, "")}`,
        confidence: 0.95,
        entry: verbEntry,
      },
    ];
  }

  const hostCandidates = await hydrateCandidates(
    host,
    await dictionaryRepository.morphology(host),
  );
  const verbs = hostCandidates.filter((candidate) => isVerb(candidate.entry));
  return verbs.slice(0, 4).map((candidate) => ({
    ...candidate,
    input,
    morphology: `${candidate.morphology || "inflected verb"} + clitic ${suffix.replace(/^[-']/u, "")}`,
    confidence: Math.min(candidate.confidence ?? 0.94, 0.94),
  }));
}

const PROCLITIC_PREFIXES = ["l'", "d'", "m'", "t'", "s'", "n'"] as const;

async function resolveProclitic(input: string): Promise<LemmaResult[]> {
  const prefix = PROCLITIC_PREFIXES.find((item) => input.startsWith(item));
  if (!prefix) return [];
  const host = input.slice(prefix.length);
  if (!host || !isSearchable(host)) return [];

  // Articles and the elided preposition preserve the lexical host directly:
  // l'escola → escola, d'universitat → universitat.
  if (prefix === "l'" || prefix === "d'") {
    const entry = await dictionaryRepository.getEntry(host);
    if (entry) {
      return [
        {
          input,
          lemma: entry.lemma,
          partOfSpeech: entry.partOfSpeech?.[0],
          morphology: `elided ${prefix} + lemma`,
          confidence: 0.97,
          entry,
        },
      ];
    }
  }

  // Weak pronouns before a finite verb: m'agrada → agradar. Resolve the
  // visible host through the same morphology index rather than guessing a
  // suffix or manufacturing a combined lemma.
  const hostCandidates = await hydrateCandidates(
    host,
    await dictionaryRepository.morphology(host),
  );
  return hostCandidates
    .filter((candidate) => isVerb(candidate.entry))
    .slice(0, 4)
    .map((candidate) => ({
      ...candidate,
      input,
      morphology: `proclitic ${prefix} + ${candidate.morphology || "inflected verb"}`,
      confidence: Math.min(candidate.confidence ?? 0.94, 0.94),
    }));
}

const PERIPHRASTIC_AUXILIARIES: Record<string, string> = {
  vaig: "first person singular",
  vas: "second person singular",
  va: "third person singular",
  vam: "first person plural",
  vàrem: "first person plural",
  vau: "second person plural",
  vàreu: "second person plural",
  van: "third person plural",
};

async function resolvePeriphrasticPast(input: string): Promise<LemmaResult[]> {
  const [auxiliary, ...remainder] = input.split(" ");
  const person = PERIPHRASTIC_AUXILIARIES[auxiliary];
  if (!person || remainder.length !== 1) return [];
  const infinitive = remainder[0];
  const entry = await dictionaryRepository.getEntry(infinitive);
  if (!isVerb(entry)) return [];
  const verbEntry = entry as DictionaryEntry;
  return [
    {
      input,
      lemma: verbEntry.lemma,
      partOfSpeech: "verb",
      morphology: `passat perifràstic · ${person}`,
      confidence: 0.99,
      entry: verbEntry,
    },
  ];
}

export async function resolveLemma(word: string): Promise<LemmaResult[]> {
  const input = normalizeCatalanInput(word);
  if (!input || !isSearchable(input)) return [];

  const periphrastic = await resolvePeriphrasticPast(input);
  if (periphrastic.length) return periphrastic;

  const indexed = await hydrateCandidates(
    input,
    await dictionaryRepository.morphology(input),
  );
  if (indexed.length) return indexed;
  const postVerbal = await resolveClitic(input);
  if (postVerbal.length) return postVerbal;
  return resolveProclitic(input);
}

function preferredVerbAnalysis(
  exactEntry: DictionaryEntry,
  candidates: LemmaResult[],
): LemmaResult | undefined {
  const differentVerb = candidates.find(
    (candidate) =>
      candidate.entry?.normalizedLemma !== exactEntry.normalizedLemma &&
      isVerb(candidate.entry),
  );
  if (!differentVerb) return undefined;
  const morphology = differentVerb.morphology?.toLowerCase() ?? "";
  if (
    (differentVerb.entry?.frequencyRank ?? Number.MAX_SAFE_INTEGER) >=
    (exactEntry.frequencyRank ?? Number.MAX_SAFE_INTEGER)
  ) {
    return undefined;
  }
  if (
    (morphology.includes("first person") || morphology.includes("1st person")) &&
    morphology.includes("present")
  ) {
    return differentVerb;
  }
  if (
    morphology.includes("past participle") &&
    (differentVerb.entry?.frequencyRank ?? Number.MAX_SAFE_INTEGER) <= 500
  ) {
    return differentVerb;
  }
  return undefined;
}

function makeFound(
  searchedForm: string,
  normalizedQuery: string,
  entry: DictionaryEntry,
  candidates: LemmaResult[],
  resolutionSource: "exact" | "normalized-exact" | "morphology" | "clitic" | "accent-fallback",
  morphology?: string,
): LookupResponse {
  return {
    status: "found",
    searchedForm,
    normalizedQuery,
    lemma: entry.lemma,
    morphology,
    confidence: candidates[0]?.confidence ?? (resolutionSource === "exact" ? 1 : 0.98),
    resolutionSource,
    entry,
    candidates,
  };
}

export async function lookupWord(query: string): Promise<LookupResponse> {
  const searchedForm = query.trim().normalize("NFC");
  const normalizedQuery = normalizeCatalanInput(query);

  if (!normalizedQuery || !isSearchable(normalizedQuery)) {
    return {
      status: "not-found",
      searchedForm,
      normalizedQuery,
      resolutionSource: "none",
      suggestions: [],
    };
  }

  const exactEntry = await dictionaryRepository.getEntry(normalizedQuery);
  if (exactEntry) {
    // Genuine homographs such as `faig` (beech / I do) and `fem`
    // (manure / we do) need both readings. Prefer a high-confidence
    // first-person verb analysis for everyday lookup, but retain the lexical
    // headword as an explicit alternative instead of deleting it from the
    // lemma-centred dictionary.
    // This tiny reviewed list does not create lemma coverage; it only resolves
    // a few everyday homographs (`faig`, `fem`, `pot`, `vol`, …) without
    // downloading a morphology shard for every ordinary exact lookup. The
    // generated morphology packs independently contain and test these forms.
    const reviewedAnalyses = FORM_INDEX[normalizedQuery] ?? [];
    const inflectedCandidates = await hydrateCandidates(
      normalizedQuery,
      reviewedAnalyses.map((candidate) => [
        candidate.lemma,
        candidate.morphology,
        candidate.partOfSpeech,
      ]),
    );
    const preferredVerb = preferredVerbAnalysis(exactEntry, inflectedCandidates);
    if (preferredVerb) {
      const exactAlternative: LemmaResult = {
        input: normalizedQuery,
        lemma: exactEntry.lemma,
        partOfSpeech: exactEntry.partOfSpeech?.[0],
        morphology: "exact lexical homograph",
        confidence: 0.86,
        entry: exactEntry,
      };
      const orderedCandidates = [
        preferredVerb,
        ...inflectedCandidates.filter(
          (candidate) =>
            candidate.entry?.normalizedLemma !==
            preferredVerb.entry?.normalizedLemma,
        ),
        exactAlternative,
      ];
      return makeFound(
        searchedForm,
        normalizedQuery,
        preferredVerb.entry!,
        orderedCandidates,
        "morphology",
        preferredVerb.morphology,
      );
    }
    const source = searchedForm === normalizedQuery ? "exact" : "normalized-exact";
    return makeFound(searchedForm, normalizedQuery, exactEntry, [], source);
  }

  const candidates = await resolveLemma(normalizedQuery);
  const best = candidates[0];
  if (best?.entry) {
    return makeFound(
      searchedForm,
      normalizedQuery,
      best.entry,
      candidates,
      best.morphology?.match(/clitic|elided/u) ? "clitic" : "morphology",
      best.morphology,
    );
  }

  const prefixSuggestions = await dictionaryRepository.prefix(normalizedQuery, 8);
  if (prefixSuggestions.length) {
    const foldedQuery = foldCatalanForFallback(normalizedQuery);
    const accentEquivalent = prefixSuggestions.find(
      (suggestion) =>
        normalizeCatalanInput(suggestion) !== normalizedQuery &&
        foldCatalanForFallback(suggestion) === foldedQuery,
    );
    const suggestions = accentEquivalent
      ? [
          accentEquivalent,
          ...prefixSuggestions.filter((item) => item !== accentEquivalent),
        ]
      : prefixSuggestions;
    return {
      status: "not-found",
      searchedForm,
      normalizedQuery,
      resolutionSource: accentEquivalent ? "fuzzy" : "prefix",
      suggestions,
    };
  }

  const fuzzy = await fuzzyCoreSuggestions(normalizedQuery, 8);
  if (fuzzy.length) {
    return {
      status: "not-found",
      searchedForm,
      normalizedQuery,
      resolutionSource: "fuzzy",
      suggestions: fuzzy,
    };
  }

  return {
    status: "not-found",
    searchedForm,
    normalizedQuery,
    resolutionSource: "none",
    suggestions: [],
  };
}

function boundedEditDistance(left: string, right: string, maximum: number): number {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution =
        previous[rightIndex - 1] +
        (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        substitution,
      );
      rowMinimum = Math.min(rowMinimum, current[rightIndex]);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previous = current;
  }
  return previous[right.length];
}

async function fuzzyCoreSuggestions(word: string, limit: number): Promise<string[]> {
  const foldedInput = foldCatalanForFallback(word);
  const maximum = foldedInput.length <= 4 ? 1 : foldedInput.length <= 8 ? 2 : 3;
  const entries = await dictionaryRepository.coreEntries().catch(() => []);
  return entries
    .map((entry) => ({
      lemma: entry.lemma,
      distance: boundedEditDistance(
        foldedInput,
        foldCatalanForFallback(entry.normalizedLemma),
        maximum,
      ),
      rank: entry.frequencyRank ?? Number.MAX_SAFE_INTEGER,
    }))
    .filter((candidate) => candidate.distance <= maximum)
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.rank - right.rank ||
        left.lemma.localeCompare(right.lemma, "ca"),
    )
    .slice(0, limit)
    .map((candidate) => candidate.lemma);
}

export async function fuzzySuggestions(word: string, limit = 3): Promise<string[]> {
  const input = normalizeCatalanInput(word);
  if (!input || input.length < 2) return [];
  const direct = await dictionaryRepository.prefix(input, limit);
  if (direct.length) return direct;
  return fuzzyCoreSuggestions(input, limit);
}

