import { normalizeSearchKey } from "./search-normalization.ts";
import type { SearchSuggestion } from "./types.ts";

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
      if (chars.length < (language === "zh" ? 2 : 3) || (best.length === limit && best.at(-1)!.score < 3)) continue;
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
