#!/usr/bin/env node
// Public dictionary text only. Every response is a machine draft, never a
// human-reviewed record. Checkpoints retain exact source fields and identities.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { grammaticalChinese } from "./bulk_chinese_rules.mjs";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const arguments_ = process.argv.slice(2);
function option(name, fallback) {
  const index = arguments_.indexOf(`--${name}`);
  return index < 0 ? fallback : arguments_[index + 1];
}
const input = resolve(option("input", "work/bulk-chinese/jobs.jsonl"));
const output = resolve(option("output", "work/bulk-chinese/results.jsonl"));
const runtime = resolve(option("runtime", "work/online-translation-runtime/node_modules/bing-translate-api"));
const limit = Number(option("limit", "0"));
const workers = Number(option("workers", "2"));
const packetChars = Number(option("packet-chars", "2600"));
const retryIssues = arguments_.includes("--retry-issues");
const targetLanguage = option("target", "zh-Hans");
if (!["zh-Hans", "en", "es"].includes(targetLanguage)) throw new Error("Unsupported translation target");
const textField = targetLanguage === "zh-Hans" ? "translationZh" : "intermediateText";
const requestLanguage = (job) => job.translationInput?.language ?? job.sourceLanguage;
const requestText = (job) => job.translationInput?.text ?? job.sourceText;
const cacheKey = (job) => `${requestLanguage(job)}:${createHash("sha256").update(requestText(job)).digest("hex")}`;
const { translate } = require(runtime);
const jobs = readFileSync(input, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const results = new Map();
const failed = new Set();
for (const [path, isIssue] of [[output, false], [`${output}.issues.jsonl`, true]]) {
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    const row = JSON.parse(line);
    if (isIssue) failed.add(row.jobId);
    else results.set(row.jobId, row);
  }
}
const pending = jobs.filter((job) => !results.has(job.jobId) && (retryIssues || !failed.has(job.jobId)));
if (limit) pending.splice(limit);
const packets = [];
for (const language of ["en", "ca", "es", "auto-detect"]) {
  let current = [], length = 0;
  for (const row of pending.filter((job) => requestLanguage(job) === language)) {
    const size = requestText(row).length + 40;
    if (current.length && (length + size > packetChars || current.length >= 40)) {
      packets.push(current); current = []; length = 0;
    }
    current.push(row); length += size;
  }
  if (current.length) packets.push(current);
}
mkdirSync(dirname(output), { recursive: true });
const cached = new Map();
for (const row of results.values()) cached.set(cacheKey(row), row[textField]);
const started = Date.now();
let position = 0, completed = 0, issueCount = 0, requestCount = 0, stopped = false;
const han = /\p{Script=Han}/u;
function flags(job, text) {
  const reasons = [];
  if (!text || (targetLanguage === "zh-Hans" && !han.test(text))) reasons.push("empty-or-non-chinese");
  if (/(.{2,8})\1{3,}/u.test(text)) reasons.push("repetition");
  if (/待翻译|待补充|\b(?:TODO|TBD)\b|ZXQSEG|QXZ/iu.test(text)) reasons.push("placeholder-or-marker");
  if (text.length > Math.max(200, job.sourceText.length * 5)) reasons.push("length-anomaly");
  if (targetLanguage === "zh-Hans" && text === job.sourceText) reasons.push("unchanged-source");
  return reasons;
}
function save(job, text, error) {
  const clean = text?.trim().replace(/^[：:、\s]+|[\s]+$/gu, "") ?? "";
  const issues = error ? [error] : flags(job, clean);
  const row = { ...job, [textField]: clean, reviewStatus: issues.length ? "needs-review" : targetLanguage !== "zh-Hans" ? "intermediate-only" : "machine-translated",
    targetLanguage,
    engine: "Microsoft Bing Translator", clientVersion: "bing-translate-api@4.2.1", issues };
  if (issues.length) {
    appendFileSync(`${output}.issues.jsonl`, `${JSON.stringify(row)}\n`);
    issueCount++;
  } else {
    appendFileSync(output, `${JSON.stringify(row)}\n`);
    results.set(job.jobId, row);
    cached.set(cacheKey(job), clean);
  }
  completed++;
}
function report() {
  const status = { processedThisRun: completed, selectedThisRun: pending.length, acceptedTotal: results.size,
    issuesThisRun: issueCount, requestsThisRun: requestCount, elapsedSeconds: Math.round((Date.now() - started) / 1000),
    remainingJobs: jobs.filter((job) => !results.has(job.jobId)).length, stopped };
  writeFileSync(`${output}.report.json`, `${JSON.stringify(status, null, 2)}\n`);
  console.log(JSON.stringify(status));
}
async function request(items) {
  if (stopped) return;
  const fresh = [];
  for (const job of items) {
    const grammatical = targetLanguage === "zh-Hans" ? grammaticalChinese(job) : undefined;
    if (grammatical) save(job, grammatical);
    else if (cached.has(cacheKey(job))) save(job, cached.get(cacheKey(job)));
    else fresh.push(job);
  }
  if (!fresh.length) return;
  const body = fresh.length === 1 ? requestText(fresh[0]) : fresh.map((job, i) => `ZXQSEG${i}QXZ ${requestText(job)}`).join("\n");
  let translated;
  try {
    requestCount++;
    translated = (await translate(body, requestLanguage(fresh[0]), targetLanguage, false)).translation;
  } catch (error) {
    // Stop on quota/captcha; do not rotate identities or bypass service limits.
    if (/limit exceeded|captcha|401|429/iu.test(String(error.message))) {
      stopped = true; report(); throw new Error("Translation service limit reached; checkpoint saved.");
    }
    if (fresh.length > 1) {
      const middle = Math.ceil(fresh.length / 2);
      await request(fresh.slice(0, middle)); await request(fresh.slice(middle)); return;
    }
    save(fresh[0], "", "service-request-failed"); return;
  }
  if (fresh.length === 1) { save(fresh[0], translated); return; }
  const markers = [...translated.matchAll(/ZXQSEG(\d+)QXZ/gu)];
  if (markers.length !== fresh.length || markers.some((match, i) => Number(match[1]) !== i)) {
    const middle = Math.ceil(fresh.length / 2);
    await request(fresh.slice(0, middle)); await request(fresh.slice(middle)); return;
  }
  for (let index = 0; index < fresh.length; index++) {
    const start = markers[index].index + markers[index][0].length;
    const end = markers[index + 1]?.index ?? translated.length;
    save(fresh[index], translated.slice(start, end));
  }
}
async function worker() {
  while (!stopped) {
    const index = position++;
    if (index >= packets.length) return;
    await request(packets[index]);
    if (index % 50 === 0) report();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
try { await Promise.all(Array.from({ length: workers }, worker)); }
catch (error) { stopped = true; console.error(error.message); process.exitCode = 1; }
finally { report(); }
