import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runDictionaryQa } from "../scripts/dictionary/qa.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function dataRows(relativePath) {
  return (await readFile(resolve(root, relativePath), "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function installLocalDictionaryFetch() {
  const publicRoot = resolve(root, "public");
  const previous = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const url = new URL(raw, "https://dictionary.qa.invalid");
    if (url.origin !== "https://dictionary.qa.invalid") {
      throw new Error(`Unexpected external QA request: ${url.href}`);
    }
    const path = resolve(publicRoot, decodeURIComponent(url.pathname).replace(/^\/+/, ""));
    assert.ok(path === publicRoot || path.startsWith(`${publicRoot}${sep}`), `Fetch escaped public/: ${url.pathname}`);
    try {
      const body = await readFile(path);
      return new Response(body, {
        status: 200,
        headers: { "content-type": url.pathname.endsWith(".json") ? "application/json" : "application/gzip" },
      });
    } catch (error) {
      if (error?.code === "ENOENT") return new Response("Not found", { status: 404 });
      throw error;
    }
  };
  return () => {
    globalThis.fetch = previous;
  };
}

test("generated dictionary passes static and real-runtime large-data acceptance", { timeout: 180_000 }, async () => {
  const report = await runDictionaryQa({ quiet: true });

  assert.ok(report.lemmaCount >= 50_000);
  assert.ok(report.morphologyFormCount >= 100_000);
  assert.ok(report.highFrequency.tested >= 300);
  assert.equal(report.highFrequency.successRate, 1);
  assert.ok(report.fixedMorphology.tested >= 200);
  assert.equal(report.fixedMorphology.successRate, 1);
  assert.deepEqual(report.random.lemmas, { tested: 100, found: 100, successRate: 1 });
  assert.deepEqual(report.random.morphology, { tested: 100, found: 100, successRate: 1 });

  const restoreFetch = installLocalDictionaryFetch();
  try {
    // Import after installing fetch so this uses the same repository and shard
    // routing code as the browser application, with local static assets as the
    // transport. No test-only lookup implementation is involved.
    const { lookupWord, normalizeCatalanInput, resolveLemma } = await import("../lib/lookup.ts");

    const highFrequency = await dataRows("data/qa/high-frequency-lemmas.txt");
    for (const lemma of highFrequency) {
      const result = await lookupWord(lemma);
      assert.equal(result.status, "found", `Runtime could not find high-frequency lemma ${lemma}`);
    }

    const morphologyCases = (await dataRows("data/qa/morphology-cases.tsv")).map((line) => {
      const [surface, lemma, coverageClass] = line.split("\t");
      return { surface, lemma, coverageClass };
    });
    for (const { surface, lemma } of morphologyCases) {
      const candidates = await resolveLemma(surface);
      assert.ok(
        candidates.some((candidate) => normalizeCatalanInput(candidate.lemma) === normalizeCatalanInput(lemma)),
        `Runtime morphology did not expose ${surface} → ${lemma}`,
      );
      const result = await lookupWord(surface);
      assert.equal(result.status, "found", `Runtime lookup failed completely for ${surface}`);
    }

    for (const lemma of report.random.sampledLemmas) {
      const result = await lookupWord(lemma);
      assert.equal(result.status, "found", `Seeded random lemma lookup failed: ${lemma}`);
      if (result.status === "found") {
        assert.equal(normalizeCatalanInput(result.lemma), normalizeCatalanInput(lemma));
      }
    }
    for (const { surface, lemma } of report.random.sampledForms) {
      const candidates = await resolveLemma(surface);
      assert.ok(
        candidates.some((candidate) => normalizeCatalanInput(candidate.lemma) === normalizeCatalanInput(lemma)),
        `Seeded random morphology lookup failed: ${surface} → ${lemma}`,
      );
    }

    const normalizationRows = await dataRows("data/qa/normalization-cases.tsv");
    for (const row of normalizationRows) {
      const [input, expected] = row.split("\t");
      assert.equal(normalizeCatalanInput(input), expected, `Normalization failed for ${input}`);
    }
    assert.notEqual(normalizeCatalanInput("si"), normalizeCatalanInput("sí"));
    assert.notEqual(normalizeCatalanInput("ma"), normalizeCatalanInput("mà"));

    // Productive weak-pronoun clusters are not counted as fake lemmas, but the
    // UI must give a useful result or suggestion instead of a dead end.
    for (const cluster of ["me'n", "te'l", "l'hi"]) {
      const result = await lookupWord(cluster);
      assert.ok(
        result.status === "found" || result.suggestions.length > 0,
        `Weak-pronoun cluster failed without guidance: ${cluster}`,
      );
    }

    const exampleLemmas = await dataRows("data/qa/example-lemmas.txt");
    for (const lemma of exampleLemmas) {
      const result = await lookupWord(lemma);
      assert.equal(result.status, "found", `Example quality entry is missing: ${lemma}`);
      if (result.status === "found") {
        assert.ok(
          (result.entry.examples?.length ?? 0) >= 2 && (result.entry.examples?.length ?? 0) <= 4,
          `${lemma} must retain 2–4 examples`,
        );
      }
    }
  } finally {
    restoreFetch();
  }
});

