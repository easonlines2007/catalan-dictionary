import { simplifyChinese } from "./chinese-search.ts";

const brackets: Record<string, string> = {
  "(": ")", "（": "）", "[": "]", "【": "】", "{": "}",
  "「": "」", "『": "』", "《": "》", "“": "”", "‘": "’",
};

/** Format a copy for display; source text and translation provenance stay intact. */
export function formatChineseMeanings(values: readonly string[] | undefined): string {
  const meanings = new Set<string>();
  for (const value of values ?? []) {
    const closing: string[] = [];
    let meaning = "";
    const append = () => {
      const text = meaning.trim();
      if (text) meanings.add(text);
      meaning = "";
    };
    for (const char of simplifyChinese(value)) {
      if (brackets[char]) closing.push(brackets[char]);
      else if (char === closing.at(-1)) closing.pop();
      else if (!closing.length && /[;；\n]/u.test(char)) {
        append();
        continue;
      }
      meaning += char;
    }
    append();
  }
  return [...meanings].join("；");
}
