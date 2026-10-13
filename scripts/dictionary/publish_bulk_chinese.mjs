#!/usr/bin/env node
// Package checkpointed output reproducibly; never invent missing translations.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { grammaticalChinese } from "./bulk_chinese_rules.mjs";

const root = resolve(".");
const jobs = readFileSync("work/bulk-chinese/jobs.jsonl", "utf8").trim().split("\n").map(JSON.parse);
const results = new Map();
if (existsSync("work/bulk-chinese/results.jsonl")) {
  for (const line of readFileSync("work/bulk-chinese/results.jsonl", "utf8").split("\n").filter(Boolean)) {
    const row = JSON.parse(line); results.set(row.jobId, row);
  }
}
const directory = resolve("data/translations/bulk");
const correctionsPath = resolve(directory, "corrections.json");
const corrections = new Map((existsSync(correctionsPath) ? JSON.parse(readFileSync(correctionsPath, "utf8")) : []).map((row) => [row.jobId, row]));
const currentIds = new Set(jobs.map((job) => job.jobId));
for (const [id] of corrections) {
  if (!currentIds.has(id)) throw new Error(`Correction does not refer to the current job plan: ${id}`);
}
const rows = [], missing = [];
let grammarCount = 0, correctionCount = 0;
for (const job of jobs) {
  const result = results.get(job.jobId);
  const grammatical = grammaticalChinese(job);
  const correction = corrections.get(job.jobId);
  const text = correction?.translationZh ?? grammatical ?? result?.translationZh;
  if (correction && correction.sourceHash !== job.sourceHash) throw new Error(`Stale correction: ${job.normalizedLemma}`);
  if (!text || !/\p{Script=Han}/u.test(text)) { missing.push(job); continue; }
  const row = { ...job, translationZh: text, reviewStatus: "machine-translated",
    engine: correction ? "source-compared correction" : grammatical ? "literal grammatical template" : result.engine };
  if (!correction && !grammatical && result.translationInput) row.translationInput = result.translationInput;
  if (correction) { row.reviewNote = correction.reason; row.reviewSources = correction.evidence ?? []; row.aliasesZh = correction.aliasesZh ?? []; correctionCount++; }
  if (grammatical && !correction) { row.aliasesZh = []; grammarCount++; }
  rows.push(row);
}
rows.sort((a, b) => a.normalizedLemma < b.normalizedLemma ? -1 : a.normalizedLemma > b.normalizedLemma ? 1 : a.jobId.localeCompare(b.jobId, "en"));
mkdirSync(directory, { recursive: true });
const sha = (data) => createHash("sha256").update(data).digest("hex");
const files = [];
for (let start = 0; start < rows.length; start += 5000) {
  const group = rows.slice(start, start + 5000);
  const raw = Buffer.from(group.map((row) => JSON.stringify(row)).join("\n") + "\n");
  const data = gzipSync(raw, { level: 9, mtime: 0 });
  const file = `bulk-${String(files.length).padStart(4, "0")}.jsonl.gz`;
  writeFileSync(resolve(directory, file), data);
  files.push({ file, rows: group.length, bytes: data.length, sha256: sha(data) });
}
const covered = new Set(rows.map((row) => row.normalizedLemma));
const missingLemmas = [...new Set(missing.map((row) => row.normalizedLemma))].filter((lemma) => !covered.has(lemma));
const manifest = { schemaVersion: 1, baseDataVersion: jobs[0].baseDataVersion,
  sourceId: "bulk-zh-ms-20261012", reviewStatus: "machine-translated", engine: "Microsoft Bing Translator",
  selectedSourceSenses: jobs.length, publishedSourceSenses: rows.length, publishedLemmas: covered.size,
  missingLemmas: missingLemmas.length, literalGrammarSenses: grammarCount, correctedSenses: correctionCount,
  jobsSha256: sha(readFileSync("work/bulk-chinese/jobs.jsonl")),
  correctionsSha256: existsSync(correctionsPath) ? sha(readFileSync(correctionsPath)) : null,
  sources: ["sources/taxa.json", "sources/chinese-references.json", "sources/fact-reference-audit.json", "sources/geographic-facts.json", "sources/dcvb-fact-audit.json", "sources/final-fact-audit.json", "source-gaps.json", "manual-corrections.json", "source-holds.json"].filter((file) => existsSync(resolve(directory, file))).map((file) => ({ file, sha256: sha(readFileSync(resolve(directory, file))) })),
  scripts: Object.fromEntries(["prepare_bulk_chinese.py", "translate_bulk_chinese.mjs", "bulk_chinese_rules.mjs", "prepare_chinese_corrections.py", "prepare_chinese_retry.py", "fetch_taxon_chinese.py", "publish_bulk_chinese.mjs"].map((name) => [name, sha(readFileSync(resolve(root, "scripts/dictionary", name)))])),
  files, note: "Machine-assisted coverage, not human lexicographer approval or complete sense coverage. Headword-only output is explicitly labelled as term reference." };
writeFileSync(resolve(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
writeFileSync("work/bulk-chinese/unresolved.jsonl", missing.map((row) => JSON.stringify(row)).join("\n") + (missing.length ? "\n" : ""));
writeFileSync("work/bulk-chinese/unresolved-lemmas.json", JSON.stringify(missingLemmas, null, 2) + "\n");
console.log(JSON.stringify({ publishedLemmas: covered.size, missingLemmas: missingLemmas.length, missingSenses: missing.length, grammarCount, correctionCount, bytes: files.reduce((sum, file) => sum + file.bytes, 0) }));
