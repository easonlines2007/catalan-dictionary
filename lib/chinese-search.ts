import data from "./chinese-search-data.json" with { type: "json" };

const conversions: Record<string, string> = data.simplified;
const readings: Record<string, string> = data.readings;
const phraseReadings = new Map<string, Array<[string[], string[]]>>();
for (const [phrase, reading] of Object.entries(data.phraseReadings)) {
  const chars = Array.from(phrase);
  const group = phraseReadings.get(chars[0]) ?? [];
  group.push([chars, reading]);
  phraseReadings.set(chars[0], group);
}
for (const group of phraseReadings.values()) group.sort((a, b) => b[0].length - a[0].length);
const phrases = new Map<string, Array<[string, string, number]>>();
for (const [key, value] of Object.entries(conversions)) {
  const chars = Array.from(key);
  if (chars.length < 2) continue;
  const group = phrases.get(chars[0]) ?? [];
  group.push([key, value, chars.length]);
  phrases.set(chars[0], group);
}
for (const group of phrases.values()) group.sort((a, b) => b[2] - a[2]);

export function simplifyChinese(value: string): string {
  const chars = Array.from(value);
  let result = "";
  for (let i = 0; i < chars.length;) {
    let matched = false;
    for (const [phrase, converted, width] of phrases.get(chars[i]) ?? []) {
      if (chars.slice(i, i + width).join("") === phrase) {
        result += converted;
        i += width;
        matched = true;
        break;
      }
    }
    if (!matched) { result += conversions[chars[i]] ?? chars[i]; i += 1; }
  }
  return result;
}

export function chineseMatchingKey(value: string): string {
  return simplifyChinese(value.normalize("NFKC").trim().toLowerCase())
    .replace(/(\p{Script=Han})\s+(?=\p{Script=Han})/gu, "$1")
    .replace(/^[“”‘’「」『』"'（(【[《<？?!！。，、；;：:]+|[“”‘’「」『』"'）)】\]》>？?!！。，、；;：:]+$/gu, "").trim();
}

export function sameChineseReading(left: string, right: string): boolean {
  return left !== right && !!readings[left] && readings[left] === readings[right];
}

/** Longest source phrase first, falling back to one primary character reading. */
export function chineseWordReadings(value: string): string[] {
  const chars = Array.from(value);
  const result: string[] = [];
  for (let i = 0; i < chars.length;) {
    const phrase = phraseReadings.get(chars[i])?.find(([key]) => key.every((char, j) => chars[i + j] === char));
    if (phrase) { result.push(...phrase[1]); i += phrase[0].length; }
    else { result.push(readings[chars[i]] ?? chars[i]); i += 1; }
  }
  return result;
}
