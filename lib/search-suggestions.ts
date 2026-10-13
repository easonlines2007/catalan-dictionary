import { normalizeSearchKey } from "./search-normalization.ts";
import type { SearchSuggestion } from "./types.ts";
import { chineseMatchingKey, chineseWordReadings, simplifyChinese } from "./chinese-search.ts";

export type SuggestionRow = [key: string, term: string, lemma: string, rank: number];

// Restricted Damerau–Levenshtein: insertion, deletion, substitution and an
// adjacent transposition each cost one. Compare code points, including rare Han.
function distance(left: string[], right: string[], maximum: number): number {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  let beforePrevious = previous;
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let minimum = i;
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1,
        previous[j - 1] + Number(left[i - 1] !== right[j - 1]));
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        current[j] = Math.min(current[j], beforePrevious[j - 2] + 1);
      }
      minimum = Math.min(minimum, current[j]);
    }
    if (minimum > maximum) return maximum + 1;
    beforePrevious = previous;
    previous = current;
  }
  return previous[right.length];
}

/** Bounded results and cooperative yielding keep typing responsive on phones. */
export async function matchSuggestions(
  rows: SuggestionRow[], query: string, language: "es" | "zh", limit = 8, signal?: AbortSignal,
): Promise<SearchSuggestion[]> {
  if (language === "zh") return matchChineseSuggestions(rows, query, limit, signal);
  const key = normalizeSearchKey(query, language);
  const chars = Array.from(key);
  if (limit <= 0 || !key || chars.length > 64 || (language === "es" && chars.length < 2)) return [];
  const maximum = chars.length < 6 ? 1 : 2;
  type Ranked = { suggestion: SearchSuggestion; score: number; rank: number; length: number };
  const best: Ranked[] = [];
  const compare = (a: Ranked, b: Ranked) => a.score - b.score || a.rank - b.rank
    || a.length - b.length || (a.suggestion.term < b.suggestion.term ? -1 : 1);
  for (let i = 0; i < rows.length; i += 1) {
    if (i % 8192 === 0) {
      if (i) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (signal?.aborted) return [];
    }
    const [candidate, term, lemma, rank] = rows[i];
    let score: number;
    let kind: SearchSuggestion["kind"];
    if (candidate === key) { score = 0; kind = "exact"; }
    else if (candidate.startsWith(key)) { score = 1; kind = "prefix"; }
    else if (candidate.includes(key)) { score = 2; kind = "contains"; }
    else {
      if (chars.length < 3 || (best.length === limit && best.at(-1)!.score < 3)) continue;
      // Most keys can be ruled out before allocating a distance matrix.
      if (Math.abs(candidate.length - key.length) > maximum * 2 || !chars.some((char) => candidate.includes(char))) continue;
      const edits = distance(chars, Array.from(candidate), maximum);
      if (edits > maximum) continue;
      score = 3 + edits;
      kind = "fuzzy";
    }
    const match = { suggestion: { term, lemma, language, kind }, score, rank, length: candidate.length };
    if (best.length === limit && compare(match, best.at(-1)!) >= 0) continue;
    if (best.some((item) => item.suggestion.term === term)) continue;
    best.push(match);
    best.sort(compare);
    if (best.length > limit) best.pop();
  }
  return signal?.aborted ? [] : best.map((item) => item.suggestion);
}

type ChineseRow = [key: string, term: string, lemma: string, rank: number, traditional?: string, readings?: string[]];
const chineseCatalogues = new WeakMap<SuggestionRow[], Promise<ChineseRow[]>>();

async function prepareChinese(rows: SuggestionRow[]): Promise<ChineseRow[]> {
  let pending = chineseCatalogues.get(rows);
  if (!pending) {
    pending = (async () => {
      const grouped = new Map<string, ChineseRow>();
      for (let i = 0; i < rows.length; i += 1) {
        if (i && i % 8192 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const [raw, term, lemma, rank] = rows[i];
        const key = chineseMatchingKey(raw);
        const identity = `${key}\0${lemma}`;
        const previous = grouped.get(identity);
        const traditional = simplifyChinese(term) !== term ? term : undefined;
        if (previous) {
          previous[3] = Math.min(previous[3], rank);
          if (term === key) previous[1] = term;
          if (traditional) previous[4] = traditional;
        } else grouped.set(identity, [key, term, lemma, rank, traditional]);
      }
      return [...grouped.values()];
    })();
    chineseCatalogues.set(rows, pending);
  }
  return pending;
}

async function matchChineseSuggestions(rows: SuggestionRow[], query: string, limit: number, signal?: AbortSignal): Promise<SearchSuggestion[]> {
  const key = chineseMatchingKey(query);
  const chars = Array.from(key);
  if (!key || limit <= 0 || chars.length > 64 || signal?.aborted) return [];
  const catalogue = await prepareChinese(rows);
  const reading = chineseWordReadings(key);
  const traditional = simplifyChinese(query) !== query;
  const negative = /^(?:不|没|无|未|非|别)/u.test(key);
  const number = key.match(/^(?:第)?[0-9一二三四五六七八九十百千万亿两零〇]+/u)?.[0];
  // A trailing 的 can obscure a useful headword, but remains a labelled
  // suggestion: it must never replace an existing exact adjective translation.
  const unmodified = chars.length >= 3 && key.endsWith("的") ? key.slice(0, -1) : undefined;
  type Ranked = { suggestion: SearchSuggestion; score: number; rank: number; length: number };
  const best: Ranked[] = [];
  const compare = (a: Ranked, b: Ranked) => a.score - b.score || a.length - b.length
    || a.rank - b.rank || a.suggestion.term.localeCompare(b.suggestion.term, "zh");
  let literal = false;
  let direct = false;
  for (let i = 0; i < catalogue.length; i += 1) {
    if (i % 8192 === 0) {
      if (i) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (signal?.aborted) return [];
    }
    const [candidate, simplifiedTerm, lemma, rank, traditionalTerm] = catalogue[i];
    const length = Array.from(candidate).length;
    const prose = (length > 8 && /[,，;；。:：]/u.test(candidate)) || length > Math.max(12, chars.length + 8);
    let score: number;
    let kind: SearchSuggestion["kind"];
    if (candidate === key) { score = 0; kind = "exact"; literal = true; direct = true; }
    else if (candidate === unmodified) { score = 0.5; kind = "related"; literal = true; direct = true; }
    else if (candidate.startsWith(key)) { score = 1 + Number(prose) * 1.5; kind = "prefix"; literal ||= !prose; direct ||= !prose; }
    else if (candidate.includes(key)) { score = 2 + Number(prose) * 1.5; kind = "contains"; literal ||= !prose; }
    else {
      if (direct || chars.length < 2 || Math.abs(length - chars.length) > (chars.length < 6 ? 1 : 2)
          || !chars.some((char) => candidate.includes(char))) continue;
      // An edit may fix spelling, but must not quietly remove 不/无 or change
      // a leading quantity/ordinal into another number.
      if (negative !== /^(?:不|没|无|未|非|别)/u.test(candidate)) continue;
      const candidateNumber = candidate.match(/^(?:第)?[0-9一二三四五六七八九十百千万亿两零〇]+/u)?.[0];
      if (number !== candidateNumber) continue;
      const other = Array.from(candidate);
      const changed = chars.filter((char, position) => char !== other[position]);
      const eligible = chars.length === length && changed.length > 0
        && changed.length <= (chars.length >= 5 ? 2 : 1)
        && chars.some((char, position) => /\p{Script=Han}/u.test(char) && char === other[position]);
      const candidateReading = eligible ? catalogue[i][5] ??= chineseWordReadings(candidate) : undefined;
      const phonetic = !!candidateReading && reading.every((sound, position) => sound === candidateReading[position]);
      if (phonetic) { score = 1.75 + changed.length * 0.1; kind = "fuzzy"; }
      else {
        if (literal) continue;
        const maximum = chars.length < 6 ? 1 : 2;
        const edits = distance(chars, other, maximum);
        if (edits > maximum) continue;
        score = 4 + edits * 0.25 + Math.abs(length - chars.length) * 0.15;
        kind = "fuzzy";
      }
    }
    if (literal) {
      for (let j = best.length - 1; j >= 0; j -= 1) {
        if (best[j].suggestion.kind === "fuzzy" && (direct || best[j].score >= 4)) best.splice(j, 1);
      }
    }
    const term = traditional && traditionalTerm ? traditionalTerm : simplifiedTerm;
    const match: Ranked = { suggestion: { term, lemma, language: "zh", kind }, score, rank, length };
    const existing = best.findIndex((item) => item.suggestion.lemma === lemma);
    if (existing >= 0) {
      if (compare(best[existing], match) <= 0) continue;
      best.splice(existing, 1);
    }
    best.push(match);
    best.sort(compare);
    if (best.length > limit) best.pop();
  }
  // Do not pad real Chinese matches with unrelated one-character corrections.
  const phonetic = best.some((item) => item.suggestion.kind === "fuzzy" && item.score < 4);
  return signal?.aborted ? [] : best.filter((item) => (!literal || item.suggestion.kind !== "fuzzy" || (!direct && item.score < 4))
    && (!phonetic || item.suggestion.kind !== "fuzzy" || item.score < 4)).map((item) => item.suggestion);
}
