import { chineseMatchingKey } from "./chinese-search.ts";
import type { PartOfSpeech } from "./types.ts";

export interface ChineseSearchIntent { term: string; preferredPartOfSpeech?: PartOfSpeech; }

/** Recognize explicit dictionary questions, without paraphrasing their content. */
export function extractChineseSearchIntent(query: string): ChineseSearchIntent | undefined {
  const input = chineseMatchingKey(query).replace(/^(?:请问|请教一下)[，,\s]*/u, "");
  const language = "\\s*(?:加泰语|加泰罗尼亚语|加泰隆尼亚语|català|catala)\\s*";
  const word = "(形容词|名词|动词|副词|单词|词语|词|说法)";
  const intent = "(?:(?:我)?(?:想找|找|有没有)(?:一个)?|一个)?";
  const meaning = "(?:表示|形容|描述|指|意思是|意思为)[：:\\s]*";
  const patterns = [
    new RegExp(`^${intent}${meaning}(.+?)的(?:${language})?${word}$`, "u"),
    new RegExp(`^${language}(?:中|里)?${intent}${meaning}(.+?)的${word}$`, "u"),
    /^(.+?)的(形容词|名词|动词|副词)$/u,
    new RegExp(`^(.+?)(?:用|在|的)?${language}(?:中|里)?(?:怎么说|如何说|怎么写|叫什么|是什么)(?:呢|呀|啊)?$`, "u"),
    new RegExp(`^(.+?)的${language}(?:是什么|怎么说|怎么写)(?:呢|呀|啊)?$`, "u"),
    new RegExp(`^${language}(?:中)?(?:怎么说|如何说|怎么写)[：:\\s]*(.+?)$`, "u"),
    new RegExp(`^(.+?)(?:翻译成|译成)${language}$`, "u"),
    /^(.+?)(?:怎么说|如何说|怎么写)(?:呢|呀|啊)?$/u,
  ];
  for (const [index, pattern] of patterns.entries()) {
    const hit = input.match(pattern);
    if (!hit) continue;
    const term = chineseMatchingKey(hit[1]);
    // Keep negation, numbers and all semantic modifiers. Reject another
    // language request, nested questions, sentences and overlong payloads.
    if (!/\p{Script=Han}/u.test(term) || Array.from(term).length > 24
        || /[，,。！？?!；;：:]|怎么|如何|翻译|(?:用|在|的).*(?:语|文)|(?:表示|形容|描述|意思是|意思为).*(?:词|说法)/u.test(term)) return;
    const classes: Record<string, PartOfSpeech> = { 名词: "noun", 动词: "verb", 形容词: "adjective", 副词: "adverb" };
    const preferredPartOfSpeech = classes[hit[2]] ?? (index < 2
      && new RegExp(`^(?:${language}(?:中|里)?)?${intent}形容`, "u").test(input) ? "adjective" : undefined);
    return { term, ...(preferredPartOfSpeech ? { preferredPartOfSpeech } : {}) };
  }
}

export function extractChineseSearchTerm(query: string): string | undefined {
  return extractChineseSearchIntent(query)?.term;
}
