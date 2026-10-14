import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { lookupWord, matchesWordClass, selectLookupCandidate, suggestWords } from "../lib/lookup.ts";
import type { PartOfSpeech } from "../lib/types.ts";

const publicRoot = resolve(import.meta.dirname, "../public");

test("Chinese meanings select the requested word class and completion clicks keep that meaning", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const path = resolve(publicRoot, new URL(String(input), "https://classes.test.invalid").pathname.replace(/^\/+/, ""));
    assert.ok(path.startsWith(publicRoot + sep));
    return new Response(await readFile(path));
  };
  try {
    const cases: Array<[string, string, PartOfSpeech]> = [
      ["形容心情低落的词", "trist", "adjective"], ["表示心情低落的名词", "tristesa", "noun"],
      ["表示高兴的名词", "alegria", "noun"], ["表示高兴的形容词", "feliç", "adjective"],
      ["表示耐心的名词", "paciència", "noun"], ["表示耐心的形容词", "pacient", "adjective"],
      ["表示强壮的名词", "força", "noun"], ["表示强壮的形容词", "fort", "adjective"],
      ["表示热的名词", "calor", "noun"], ["表示热的形容词", "calent", "adjective"],
      ["表示危险的名词", "perill", "noun"], ["表示危险的形容词", "perillós", "adjective"],
      ["表示自由的名词", "llibertat", "noun"], ["表示自由的形容词", "lliure", "adjective"],
      ["表示干净的名词", "netedat", "noun"], ["表示干净的形容词", "net", "adjective"],
      ["表示选择的动词", "escollir", "verb"], ["表示选择的名词", "elecció", "noun"],
      ["表示担心的动词", "preocupar", "verb"], ["表示担心的名词", "preocupació", "noun"],
      ["表示学习的动词", "aprendre", "verb"], ["表示学习的名词", "aprenentatge", "noun"],
      ["表示疲劳的名词", "cansament", "noun"], ["表示疲劳的形容词", "cansat", "adjective"],
      ["表示平静的名词", "tranquil·litat", "noun"], ["表示平静的形容词", "tranquil", "adjective"],
      ["形容遥远的词", "llunyà", "adjective"], ["表示遥远的副词", "lluny", "adverb"],
      ["表示不开心的形容词", "trist", "adjective"], ["表示没有耐心的形容词", "impacient", "adjective"],
      ["高兴的名词", "alegria", "noun"], ["不开心的形容词", "trist", "adjective"],
    ];
    for (const [query, lemma, preference] of cases) {
      for (const mode of ["zh", "auto"] as const) {
        const found = await lookupWord(query, mode);
        assert.equal(found.status, "found", query);
        if (found.status !== "found") continue;
        assert.equal(found.entry.normalizedLemma, lemma, query);
        assert.equal(found.preferredPartOfSpeech, preference, query);
        assert.equal(matchesWordClass(found, preference), true, query);
        const hint = (await suggestWords(query, mode))[0];
        assert.equal(hint?.lemma, lemma, `completion: ${query}`);
        const selected = await lookupWord(hint.term, hint.language);
        assert.equal(selected.status, "found", query);
        if (selected.status === "found") {
          assert.equal(selected.entry.normalizedLemma, lemma, `completion click: ${query}`);
          assert.equal(matchesWordClass(selected, preference), true, query);
        }
      }
    }
    for (const [query, lemma, preference] of [["耐心", "pacient", "noun"], ["强壮", "fort", "noun"]] as const) {
      const found = await lookupWord(query, "zh");
      assert.equal(found.status, "found");
      if (found.status !== "found") continue;
      const candidate = found.candidates.find((item) => item.entry?.normalizedLemma === lemma)!;
      assert.ok(candidate.entry?.partOfSpeech?.includes(preference), "The lemma also has an unrelated noun sense");
      assert.equal(candidate.semanticMatch?.partOfSpeech, "adjective");
      assert.equal(matchesWordClass(candidate, preference), false, "The matched Chinese sense is adjectival, not that other noun sense");
      assert.equal(matchesWordClass({ entry: candidate.entry }, preference), false,
        "Older data without sense annotations cannot claim the class of an unrelated sense");
    }
    const found = await lookupWord("表示高兴的名词", "zh");
    assert.equal(found.status, "found");
    if (found.status === "found") {
      const alternate = found.candidates.find((candidate) => candidate.entry?.normalizedLemma === "feliç")!;
      const selected = selectLookupCandidate(found, alternate);
      assert.equal(selected.entry.normalizedLemma, "feliç");
      assert.equal(selected.confidence, alternate.confidence);
      assert.equal(selected.semanticMatch?.partOfSpeech, "adjective");
      assert.equal(selected.searchedForm, found.searchedForm);
      assert.equal(selectLookupCandidate(found, { ...alternate }), found, "Unbound candidates cannot replace the result");
      const cached = JSON.parse(JSON.stringify(selected));
      const desired = cached.candidates.find((candidate: { lemma: string }) => candidate.lemma === "alegria");
      const restored = selectLookupCandidate(cached, desired);
      assert.equal(restored.entry.normalizedLemma, "alegria", "An explicit suggestion restores its displayed word over a cached alternate");
      assert.equal(matchesWordClass(restored, "noun"), true);
    }
    const unavailable = await lookupWord("表示学校的副词", "zh");
    assert.equal(unavailable.status, "found");
    if (unavailable.status === "found") {
      assert.equal(unavailable.preferredPartOfSpeech, "adverb");
      assert.equal(matchesWordClass(unavailable, "adverb"), false);
    }
    assert.deepEqual(await suggestWords("表示学校的副词", "zh"), []);
    assert.deepEqual(await suggestWords("表示高兴的名词", "zh", 0), []);
    assert.equal((await lookupWord("形容不是很开心的词", "auto")).status, "not-found");
  } finally { globalThis.fetch = previousFetch; }
});
