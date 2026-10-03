import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  lookupWord,
  normalizeCatalanInput,
  resolveLemma,
} from "../lib/lookup.ts";
import { primaryChinese, primarySpanish } from "../lib/types.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(root, "public");

globalThis.fetch = async (input) => {
  const raw =
    typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const url = new URL(raw, "https://dictionary.test.invalid");
  assert.equal(url.origin, "https://dictionary.test.invalid");
  const path = resolve(
    publicRoot,
    decodeURIComponent(url.pathname).replace(/^\/+/, ""),
  );
  assert.ok(path === publicRoot || path.startsWith(`${publicRoot}${sep}`));
  try {
    return new Response(await readFile(path), {
      status: 200,
      headers: {
        "content-type": url.pathname.endsWith(".json")
          ? "application/json"
          : "application/gzip",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Response("Not found", { status: 404 });
    }
    throw error;
  }
};

const morphologyCases = [
  ["vaig", "anar"],
  ["faig", "fer"],
  ["tinc", "tenir"],
  ["soc", "ser"],
  ["he", "haver"],
  ["vull", "voler"],
  ["puc", "poder"],
  ["dic", "dir"],
  ["anem", "anar"],
  ["anava", "anar"],
  ["fem", "fer"],
  ["tenia", "tenir"],
  ["pujant", "pujar"],
  ["pujarem", "pujar"],
  ["renyin", "renyar"],
  ["tornin", "tornar"],
  ["cases", "casa"],
  ["petita", "petit"],
  ["petites", "petit"],
] as const;

for (const [input, expectedLemma] of morphologyCases) {
  test(`${input} resolves to ${expectedLemma} through morphology`, async () => {
    const result = await lookupWord(input);
    assert.equal(result.status, "found");
    if (result.status !== "found") return;
    assert.equal(result.lemma, expectedLemma);
    assert.equal(result.resolutionSource, "morphology");
    assert.ok(result.morphology);
  });
}

test("pujant returns the complete acceptance result", async () => {
  const result = await lookupWord("pujant");
  assert.equal(result.status, "found");
  if (result.status !== "found") return;
  assert.equal(result.lemma, "pujar");
  assert.equal(result.morphology, "gerund");
  assert.match(primaryChinese(result.entry), /上去/);
  assert.match(primaryChinese(result.entry), /上升/);
  assert.match(primarySpanish(result.entry), /subir/);
  assert.ok(
    (result.entry.examples?.length ?? 0) >= 2 &&
      (result.entry.examples?.length ?? 0) <= 4,
  );
});

test("exact lookup wins before morphology and fuzzy search", async () => {
  const result = await lookupWord("conèixer");
  assert.equal(result.status, "found");
  if (result.status !== "found") return;
  assert.equal(result.lemma, "conèixer");
  assert.equal(result.resolutionSource, "exact");
  assert.deepEqual(result.candidates, []);
});

test("accent-less miss only becomes a fuzzy suggestion", async () => {
  assert.deepEqual(await resolveLemma("coneixer"), []);
  const result = await lookupWord("coneixer");
  assert.equal(result.status, "not-found");
  if (result.status !== "not-found") return;
  assert.equal(result.resolutionSource, "fuzzy");
  assert.equal(result.suggestions[0], "conèixer");
});

test("ambiguity is retained and ranked", async () => {
  const result = await lookupWord("cases");
  assert.equal(result.status, "found");
  if (result.status !== "found") return;
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.lemma),
    ["casa", "casar"],
  );
  assert.ok(
    (result.candidates[0].confidence ?? 0) >
      (result.candidates[1].confidence ?? 0),
  );
});

test("forward-generated local paradigms broaden regular coverage safely", async () => {
  for (const [form, lemma] of [
    ["agafo", "agafar"],
    ["menjant", "menjar"],
    ["cantonades", "cantonada"],
  ] as const) {
    const result = await lookupWord(form);
    assert.equal(result.status, "found");
    if (result.status === "found") assert.equal(result.lemma, lemma);
  }

  assert.deepEqual(await resolveLemma("xyzant"), []);
});

test("recognized post-verbal clitics resolve through a known host", async () => {
  const anar = await lookupWord("anar-hi");
  assert.equal(anar.status, "found");
  if (anar.status === "found") assert.equal(anar.lemma, "anar");

  const fer = await lookupWord("fes-ho");
  assert.equal(fer.status, "found");
  if (fer.status === "found") assert.equal(fer.lemma, "fer");
});

test("Catalan elision and pre-verbal weak pronouns resolve their lexical host", async () => {
  for (const [surface, lemma] of [
    ["l'escola", "escola"],
    ["d'universitat", "universitat"],
    ["m'agrada", "agradar"],
    ["t'agrada", "agradar"],
    ["l'agrada", "agradar"],
  ] as const) {
    const result = await lookupWord(surface);
    assert.equal(result.status, "found", surface);
    if (result.status === "found") assert.equal(result.lemma, lemma, surface);
  }
});

test("normalization preserves Catalan distinctions", () => {
  assert.equal(normalizeCatalanInput(" PUJANT "), "pujant");
  assert.equal(normalizeCatalanInput("cone\u0300ixer"), "conèixer");
  assert.equal(normalizeCatalanInput("L’ESCOLA"), "l'escola");
  assert.equal(normalizeCatalanInput("ME’N"), "me'n");
  assert.equal(normalizeCatalanInput("coŀlegi"), "col·legi");
  assert.notEqual(normalizeCatalanInput("ma"), normalizeCatalanInput("mà"));
});

test("empty and punctuation-only input do not invent a lemma", async () => {
  const empty = await lookupWord("   ");
  assert.equal(empty.status, "not-found");
  const punctuation = await lookupWord("...");
  assert.equal(punctuation.status, "not-found");
  if (punctuation.status === "not-found") {
    assert.deepEqual(punctuation.suggestions, []);
  }
});

test("prefix and bounded fuzzy suggestions use the large local index", async () => {
  const prefix = await lookupWord("universi");
  assert.equal(prefix.status, "not-found");
  if (prefix.status === "not-found") {
    assert.equal(prefix.resolutionSource, "prefix");
    assert.ok(prefix.suggestions.includes("universitat"));
  }

  const typo = await lookupWord("ordinadr");
  assert.equal(typo.status, "not-found");
  if (typo.status === "not-found") {
    assert.equal(typo.resolutionSource, "fuzzy");
    assert.ok(typo.suggestions.includes("ordinador"));
  }
});

