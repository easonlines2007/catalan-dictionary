/** Literal grammatical descriptions preserve referenced Catalan spellings. */
export function grammaticalChinese(job) {
  if (job.kind === "headword" && job.sourceLanguage === "ca" && job.sourcePartOfSpeech.includes("pronoun")) {
    const parts = job.sourceText.split(/[\s'’-]+/u).filter(Boolean);
    if (parts.length >= 2 && parts.every((part) => /^(?:el|els|la|les|lo|los|ho|en|ne|hi|em|me|et|te|ens|mos|us|vos|es|se|li|m|t|s|l|n)$/u.test(part))) {
      return `加泰语弱读代词组合「${job.sourceText}」`;
    }
  }
  if (job.kind !== "definition" && job.sourcePartOfSpeech.includes("noun") && /^\p{Script=Latin}$/u.test(job.sourceText)) {
    return `拉丁字母 ${job.sourceText.toUpperCase()}（${job.sourceText}）`;
  }
  if (job.sourceLanguage !== "en" || job.kind !== "definition") return;
  const patterns = [
    [/^alternative (?:form|spelling) of (.+?)[.]?$/iu, "另一种形式或拼写"],
    [/^obsolete (?:form|spelling) of (.+?)[.]?$/iu, "旧式形式或拼写"],
    [/^archaic (?:form|spelling) of (.+?)[.]?$/iu, "古式形式或拼写"],
    [/^synonym of (.+?)[.]?$/iu, "同义词"],
    [/^(?:abbreviation|clipping) of (.+?)[.]?$/iu, "缩略形式"],
    [/^misspelling of (.+?)[.]?$/iu, "误拼形式"],
    [/^plural (?:form )?of (.+?)[.]?$/iu, "复数形式"],
    [/^feminine (?:singular )?(?:form )?of (.+?)[.]?$/iu, "阴性形式"],
    [/^masculine (?:singular )?(?:form )?of (.+?)[.]?$/iu, "阳性形式"],
    [/^diminutive of (.+?)[.]?$/iu, "指小形式"],
    [/^augmentative of (.+?)[.]?$/iu, "指大形式"],
    [/^contraction of (.+?)[.]?$/iu, "缩合形式"],
  ];
  for (const [pattern, description] of patterns) {
    const hit = job.sourceText.match(pattern);
    if (hit && hit[1].length < 100) return `「${hit[1]}」的${description}`;
  }
}
