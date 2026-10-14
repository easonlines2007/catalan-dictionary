import { chineseMatchingKey } from "./chinese-search.ts";

export type ChineseSemanticRow = [key: string, expression: string, lemma: string, label: string, rank: number, concept: string];

/** Meaning expressions are source-compared data, never spelling-distance hits. */
export function semanticRows(rows: ChineseSemanticRow[], query: string, limit = 32): ChineseSemanticRow[] {
  const key = chineseMatchingKey(query);
  if (!key || Array.from(key).length > 64 || limit <= 0) return [];
  let left = 0, right = rows.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (rows[middle][0] < key) left = middle + 1;
    else right = middle;
  }
  const result: ChineseSemanticRow[] = [];
  const lemmas = new Set<string>();
  for (let i = left; i < rows.length && rows[i][0] === key && result.length < limit; i += 1) {
    if (lemmas.has(rows[i][2])) continue;
    lemmas.add(rows[i][2]);
    result.push(rows[i]);
  }
  return result;
}
