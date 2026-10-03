#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, "../..");
const DEFAULT_SEED = "catalan-dictionary-pwa-qa-v1";

export function normalizeCatalan(value) {
  return String(value)
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("ca-ES")
    .replace(/[’‘ʼ＇`´]/g, "'")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\u0140l/g, "l·l")
    .replace(/l[•∙⋅‧]l/g, "l·l")
    .replace(/\s+/g, " ");
}

async function readLines(path) {
  return (await readFile(path, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function readMorphologyCases(path) {
  const sourceLines = (await readFile(path, "utf8")).split(/\r?\n/u);
  const rows = [];
  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index].trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("\t");
    assert.equal(fields.length, 3, `Morphology QA line ${index + 1} must have exactly 3 TSV fields`);
    const [surface, lemma, coverageClass] = fields;
    assert.ok(surface && lemma && coverageClass, `Invalid morphology QA line ${index + 1}`);
    rows.push({
      surface: normalizeCatalan(surface),
      lemma: normalizeCatalan(lemma),
      coverageClass,
    });
  }
  return rows;
}

function getDescriptors(manifest, key) {
  const value = manifest[key] ?? manifest.shards?.[key];
  assert.ok(Array.isArray(value) && value.length > 0, `manifest.${key} must contain shard descriptors`);
  return value;
}

function assetPath(root, descriptorPath) {
  assert.equal(typeof descriptorPath, "string", "Every shard descriptor needs a path");
  const relative = descriptorPath.replace(/^\/+/, "");
  const publicRoot = resolve(root, "public");
  const resolved = resolve(publicRoot, relative);
  assert.ok(
    resolved === publicRoot || resolved.startsWith(`${publicRoot}${sep}`),
    `Shard path escapes public/: ${descriptorPath}`,
  );
  assert.equal(isAbsolute(relative), false, `Shard path must be public-relative: ${descriptorPath}`);
  return resolved;
}

async function readShard(root, descriptor) {
  const path = assetPath(root, descriptor.path);
  const compressed = await readFile(path);
  assert.ok(
    compressed[0] === 0x1f && compressed[1] === 0x8b,
    `Dictionary shard is not gzip-compressed: ${descriptor.path}`,
  );
  if (descriptor.bytes !== undefined) {
    assert.equal(compressed.byteLength, descriptor.bytes, `Byte count mismatch for ${descriptor.path}`);
  }
  if (descriptor.sha256) {
    const actual = createHash("sha256").update(compressed).digest("hex");
    assert.equal(actual, String(descriptor.sha256).toLowerCase(), `SHA-256 mismatch for ${descriptor.path}`);
  }
  const payload = gunzipSync(compressed);
  return JSON.parse(payload.toString("utf8"));
}

function packedLemma(entry) {
  if (Array.isArray(entry)) return entry[0];
  return entry?.l ?? entry?.lemma;
}

function packedNormalizedLemma(entry) {
  if (Array.isArray(entry)) return entry[1] ?? entry[0];
  return entry?.n ?? entry?.normalizedLemma ?? packedLemma(entry);
}

function packedPartOfSpeech(entry) {
  if (Array.isArray(entry)) return entry[2];
  return entry?.p ?? entry?.partOfSpeech;
}

function packedSpanish(entry) {
  if (Array.isArray(entry)) return undefined;
  return entry?.es ?? entry?.spanish;
}

function packedChinese(entry) {
  if (Array.isArray(entry)) return undefined;
  return entry?.zh ?? entry?.chinese;
}

function packedSources(entry) {
  if (Array.isArray(entry)) return undefined;
  return entry?.s ?? entry?.source;
}

function hasContent(value) {
  if (Array.isArray(value)) return value.some((item) => typeof item === "string" && item.trim());
  return typeof value === "string" && Boolean(value.trim());
}

function uniqueArray(left, right) {
  return [...new Set([...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])])];
}

function mergePackedEntry(base, enrichment) {
  if (!base) return structuredClone(enrichment);
  const merged = { ...base };
  for (const field of ["p", "pl", "zh", "es", "f", "s"]) {
    const values = uniqueArray(base[field], enrichment[field]);
    if (values.length) merged[field] = values;
  }
  const definitions = {};
  for (const language of ["ca", "es", "zh", "en"]) {
    const values = uniqueArray(base.d?.[language], enrichment.d?.[language]);
    if (values.length) definitions[language] = values;
  }
  if (Object.keys(definitions).length) merged.d = definitions;
  const examples = [...(base.ex ?? []), ...(enrichment.ex ?? [])];
  if (examples.length) {
    merged.ex = [...new Map(examples.map((example) => [JSON.stringify(example), example])).values()];
  }
  if (!merged.g && enrichment.g) merged.g = enrichment.g;
  if (!merged.ipa && enrichment.ipa) merged.ipa = enrichment.ipa;
  if (!merged.l && enrichment.l) merged.l = enrichment.l;
  if (typeof enrichment.r === "number") merged.r = Math.min(base.r ?? Infinity, enrichment.r);
  return merged;
}

function morphRecord(record) {
  if (Array.isArray(record)) return { surface: record[0], analyses: record[1] };
  return {
    surface: record?.surface ?? record?.f ?? record?.form,
    analyses: record?.analyses ?? record?.a ?? record?.results,
  };
}

function analysisLemma(analysis) {
  if (Array.isArray(analysis)) return analysis[0];
  return analysis?.l ?? analysis?.lemma;
}

function accentFold(value) {
  return normalizeCatalan(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC");
}

function descriptorForKey(descriptors, key) {
  let low = 0;
  let high = descriptors.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const descriptor = descriptors[middle];
    if (key < normalizeCatalan(descriptor.first)) high = middle - 1;
    else if (key > normalizeCatalan(descriptor.last)) low = middle + 1;
    else return descriptor;
  }
  return undefined;
}

function validateDescriptorSet(name, descriptors, globalIds, globalPaths) {
  assert.ok(Array.isArray(descriptors) && descriptors.length > 0, `${name} descriptors are required`);
  for (let index = 0; index < descriptors.length; index += 1) {
    const descriptor = descriptors[index];
    assert.ok(descriptor.id && descriptor.path, `${name}[${index}] needs id and path`);
    assert.equal(globalIds.has(`${name}:${descriptor.id}`), false, `Duplicate descriptor id ${name}:${descriptor.id}`);
    assert.equal(globalPaths.has(descriptor.path), false, `Duplicate descriptor path ${descriptor.path}`);
    globalIds.add(`${name}:${descriptor.id}`);
    globalPaths.add(descriptor.path);
    assert.ok(Number.isInteger(descriptor.entries) && descriptor.entries > 0, `Invalid entries for ${descriptor.path}`);
    assert.ok(Number.isInteger(descriptor.bytes) && descriptor.bytes > 0, `Invalid bytes for ${descriptor.path}`);
    assert.ok(normalizeCatalan(descriptor.first) <= normalizeCatalan(descriptor.last), `Invalid range for ${descriptor.path}`);
    if (index > 0) {
      const previous = descriptors[index - 1];
      assert.ok(
        normalizeCatalan(previous.last) < normalizeCatalan(descriptor.first),
        `${name} descriptor ranges overlap or are out of order: ${previous.path}, ${descriptor.path}`,
      );
    }
  }
}

function routeExact(descriptors, recordsByPath, key, keyFor) {
  const descriptor = descriptorForKey(descriptors, key);
  if (!descriptor) return undefined;
  return recordsByPath.get(descriptor.path)?.find((record) => normalizeCatalan(keyFor(record)) === key);
}

function hashSeed(seed) {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicSample(values, count, seed) {
  assert.ok(values.length >= count, `Cannot sample ${count} records from only ${values.length}`);
  const indexes = Array.from({ length: values.length }, (_, index) => index);
  const random = mulberry32(hashSeed(seed));
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [indexes[index], indexes[other]] = [indexes[other], indexes[index]];
  }
  return indexes.slice(0, count).map((index) => values[index]);
}

function validateShardBounds(descriptor, records, keyFor) {
  assert.ok(Array.isArray(records), `${descriptor.path} must contain a JSON array`);
  if (descriptor.entries !== undefined) {
    assert.equal(records.length, descriptor.entries, `Entry count mismatch for ${descriptor.path}`);
  }
  if (!records.length) return;
  const keys = records.map((record) => normalizeCatalan(keyFor(record)));
  for (let index = 1; index < keys.length; index += 1) {
    // Runtime shard routing uses ordinary JS string comparisons, so the build
    // output must use the same deterministic UTF-16 ordering rather than a
    // locale-dependent collation order.
    assert.ok(keys[index - 1] <= keys[index], `${descriptor.path} is not sorted for runtime routing`);
  }
  if (descriptor.first !== undefined) {
    assert.equal(keys[0], normalizeCatalan(descriptor.first), `First-key mismatch for ${descriptor.path}`);
  }
  if (descriptor.last !== undefined) {
    assert.equal(keys.at(-1), normalizeCatalan(descriptor.last), `Last-key mismatch for ${descriptor.path}`);
  }
}

export async function runDictionaryQa(options = {}) {
  const root = resolve(options.root ?? DEFAULT_ROOT);
  const minimumLemmas = Number(options.minimumLemmas ?? process.env.QA_MIN_LEMMAS ?? 50_000);
  const sampleSize = Number(options.sampleSize ?? process.env.QA_SAMPLE_SIZE ?? 100);
  const seed = String(options.seed ?? process.env.QA_RANDOM_SEED ?? DEFAULT_SEED);
  const manifestPath = resolve(root, "public/dictionary/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert.ok(Number.isInteger(manifest.schemaVersion), "manifest.schemaVersion must be an integer");
  assert.ok(typeof manifest.dataVersion === "string" && manifest.dataVersion, "manifest.dataVersion is required");
  assert.ok(manifest.lemmaCount >= minimumLemmas, `Expected at least ${minimumLemmas} lemmas, got ${manifest.lemmaCount}`);
  assert.ok(Array.isArray(manifest.sources) && manifest.sources.length >= 2, "Manifest must attribute at least two open data sources");
  for (const source of manifest.sources) {
    assert.ok(source.id && source.name && source.license && source.url, "Every manifest source needs id, name, license and URL");
  }
  assert.ok(manifest.sizes?.rawBytes > 0, "Manifest needs aggregate raw size metrics");
  assert.ok(manifest.sizes?.initialRawBytes > 0, "Manifest needs initial-load size metrics");
  assert.ok(manifest.sizes?.initialGzipBytes > 0, "Manifest needs compressed initial-load size metrics");

  const lexDescriptors = getDescriptors(manifest, "lex");
  const morphDescriptors = getDescriptors(manifest, "morph");
  const prefixDescriptors = getDescriptors(manifest, "prefix");
  const enrichment = manifest.enrichment ?? {};
  const lexicalEnrichmentDescriptorSets = Object.entries(enrichment).filter(
    ([layer]) => layer === "freedict" || layer === "wiktionary" || layer === "curated",
  );
  const morphologyEnrichmentDescriptorSets = Object.entries(enrichment).filter(
    ([layer]) => /morph/i.test(layer),
  );
  const prefixEnrichmentDescriptorSets = Object.entries(enrichment).filter(
    ([layer]) => /prefix/i.test(layer),
  );
  const descriptorGroups = [
    ["lex", lexDescriptors],
    ["morph", morphDescriptors],
    ["prefix", prefixDescriptors],
    ...lexicalEnrichmentDescriptorSets.map(([layer, descriptors]) => [`enrichment.${layer}`, descriptors]),
    ...morphologyEnrichmentDescriptorSets.map(([layer, descriptors]) => [`enrichment.${layer}`, descriptors]),
    ...prefixEnrichmentDescriptorSets.map(([layer, descriptors]) => [`enrichment.${layer}`, descriptors]),
  ];
  const descriptorIds = new Set();
  const descriptorPaths = new Set();
  for (const [name, descriptors] of descriptorGroups) {
    validateDescriptorSet(name, descriptors, descriptorIds, descriptorPaths);
  }

  const lexEntries = [];
  const enrichmentEntries = [];
  const morphRecords = [];
  const prefixRecords = [];
  const recordsByPath = new Map();

  for (const descriptor of lexDescriptors) {
    const records = await readShard(root, descriptor);
    recordsByPath.set(descriptor.path, records);
    validateShardBounds(descriptor, records, packedNormalizedLemma);
    lexEntries.push(...records);
  }
  for (const descriptor of morphDescriptors) {
    const records = await readShard(root, descriptor);
    recordsByPath.set(descriptor.path, records);
    validateShardBounds(descriptor, records, (record) => morphRecord(record).surface);
    morphRecords.push(...records);
  }
  const baseMorphRecordCount = morphRecords.length;
  for (const [layer, descriptors] of lexicalEnrichmentDescriptorSets) {
    assert.ok(Array.isArray(descriptors), `manifest.enrichment.${layer} must be an array`);
    for (const descriptor of descriptors) {
      const records = await readShard(root, descriptor);
      recordsByPath.set(descriptor.path, records);
      validateShardBounds(descriptor, records, packedNormalizedLemma);
      enrichmentEntries.push(...records);
    }
  }
  for (const [layer, descriptors] of morphologyEnrichmentDescriptorSets) {
    assert.ok(Array.isArray(descriptors), `manifest.enrichment.${layer} must be an array`);
    for (const descriptor of descriptors) {
      const records = await readShard(root, descriptor);
      recordsByPath.set(descriptor.path, records);
      validateShardBounds(descriptor, records, (record) => morphRecord(record).surface);
      morphRecords.push(...records);
    }
  }
  for (const descriptor of prefixDescriptors) {
    const records = await readShard(root, descriptor);
    recordsByPath.set(descriptor.path, records);
    validateShardBounds(descriptor, records, (record) => record[0]);
    for (const [foldedKey, targetLemmas] of records) {
      assert.ok(typeof foldedKey === "string" && foldedKey, `Invalid prefix key in ${descriptor.path}`);
      assert.ok(Array.isArray(targetLemmas) && targetLemmas.length > 0, `Prefix ${foldedKey} needs a lemma array`);
      for (const lemma of targetLemmas) {
        assert.ok(typeof lemma === "string" && lemma, `Invalid prefix lemma for ${foldedKey}`);
      }
    }
    prefixRecords.push(...records);
  }
  for (const [layer, descriptors] of prefixEnrichmentDescriptorSets) {
    assert.ok(Array.isArray(descriptors), `manifest.enrichment.${layer} must be an array`);
    for (const descriptor of descriptors) {
      const records = await readShard(root, descriptor);
      recordsByPath.set(descriptor.path, records);
      validateShardBounds(descriptor, records, (record) => record[0]);
      prefixRecords.push(...records);
    }
  }
  for (const [name, descriptors] of descriptorGroups) {
    const lowerName = name.toLowerCase();
    const keyFor = lowerName.includes("morph")
      ? (record) => morphRecord(record).surface
      : lowerName.includes("prefix")
        ? (record) => record[0]
        : packedNormalizedLemma;
    const keys = descriptors.flatMap((descriptor) =>
      recordsByPath.get(descriptor.path).map((record) => normalizeCatalan(keyFor(record))),
    );
    assert.equal(new Set(keys).size, keys.length, `${name} contains duplicate keys across its layer`);
  }

  assert.equal(
    lexEntries.length,
    manifest.baseLemmaCount ?? manifest.lemmaCount,
    "manifest base lemma count must equal decoded base lexical records",
  );
  assert.equal(
    baseMorphRecordCount,
    manifest.baseMorphologyFormCount ?? baseMorphRecordCount,
    "manifest base morphology count must equal decoded base morphology descriptors",
  );

  assert.ok(manifest.coreDescriptors?.lex && manifest.coreDescriptors?.morph, "Manifest needs verifiable core descriptors");
  const coreLex = await readShard(root, manifest.coreDescriptors.lex);
  const coreMorph = await readShard(root, manifest.coreDescriptors.morph);
  validateShardBounds(manifest.coreDescriptors.lex, coreLex, packedNormalizedLemma);
  validateShardBounds(manifest.coreDescriptors.morph, coreMorph, (record) => morphRecord(record).surface);
  assert.equal(coreLex.length, manifest.coreLemmaCount, "Core lexical count mismatch");
  assert.equal(coreMorph.length, manifest.coreFormCount, "Core morphology count mismatch");
  assert.equal(manifest.core.lex, manifest.coreDescriptors.lex.path, "Core lex path/descriptor mismatch");
  assert.equal(manifest.core.morph, manifest.coreDescriptors.morph.path, "Core morph path/descriptor mismatch");
  assert.equal(
    manifest.sizes.initialGzipBytes,
    manifest.coreDescriptors.lex.bytes + manifest.coreDescriptors.morph.bytes,
    "Initial gzip size must equal the two core assets",
  );

  const lemmas = new Map();
  for (const entry of [...lexEntries, ...enrichmentEntries]) {
    const rawNormalizedLemma = packedNormalizedLemma(entry);
    assert.ok(
      typeof rawNormalizedLemma === "string" && rawNormalizedLemma.trim(),
      "Every packed entry needs a non-empty normalized lemma",
    );
    const normalizedLemma = normalizeCatalan(rawNormalizedLemma);
    lemmas.set(normalizedLemma, mergePackedEntry(lemmas.get(normalizedLemma), entry));
  }
  assert.equal(lemmas.size, manifest.lemmaCount, "manifest.lemmaCount must equal the merged layer union");

  let partOfSpeechEntries = 0;
  let sourcedEntries = 0;
  let spanishEntries = 0;
  let chineseEntries = 0;
  let definitionEntries = 0;
  let meaningEntries = 0;
  const knownSourceIds = new Set(manifest.sources.map((source) => source.id));
  for (const entry of lemmas.values()) {
    const lemma = packedLemma(entry);
    const normalizedLemma = normalizeCatalan(packedNormalizedLemma(entry));
    assert.ok(typeof lemma === "string" && lemma.normalize("NFC") === lemma && lemma.trim(), "Every entry needs an NFC lemma");
    assert.equal(normalizeCatalan(lemma), normalizedLemma, `normalizedLemma mismatch for ${lemma}`);
    assert.equal(normalizedLemma, normalizeCatalan(packedNormalizedLemma(entry)));
    if (hasContent(packedPartOfSpeech(entry))) partOfSpeechEntries += 1;
    if (hasContent(packedSources(entry))) sourcedEntries += 1;
    if (hasContent(packedSpanish(entry))) spanishEntries += 1;
    if (hasContent(packedChinese(entry))) chineseEntries += 1;
    if (hasContent(entry.d?.ca)) definitionEntries += 1;
    if (hasContent(entry.d?.ca) || hasContent(packedSpanish(entry)) || hasContent(packedChinese(entry))) {
      meaningEntries += 1;
    }
    for (const sourceId of packedSources(entry) ?? []) {
      assert.ok(knownSourceIds.has(sourceId), `Entry ${lemma} refers to unknown source ${sourceId}`);
    }
  }
  assert.ok(sourcedEntries / lemmas.size >= 0.99, "At least 99% of entries must retain source attribution");

  for (const [foldedKey, targetLemmas] of prefixRecords) {
    for (const lemma of targetLemmas) {
      const normalizedLemma = normalizeCatalan(lemma);
      assert.ok(lemmas.has(normalizedLemma), `Prefix ${foldedKey} points to missing lemma ${lemma}`);
      assert.equal(accentFold(normalizedLemma), normalizeCatalan(foldedKey), `Prefix key mismatch for ${lemma}`);
    }
  }
  const mergedPrefixKeys = new Set(prefixRecords.map(([key]) => normalizeCatalan(key)));
  assert.equal(mergedPrefixKeys.size, manifest.prefixKeyCount, "Merged prefix key count mismatch");

  const morphology = new Map();
  for (const rawRecord of morphRecords) {
    const { surface, analyses } = morphRecord(rawRecord);
    const normalizedSurface = normalizeCatalan(surface);
    assert.ok(typeof surface === "string" && normalizedSurface, "Every morphology record needs a surface form");
    assert.ok(Array.isArray(analyses) && analyses.length > 0, `No analyses for morphology form ${surface}`);
    const mappedLemmas = new Set();
    for (const analysis of analyses) {
      const rawLemma = analysisLemma(analysis);
      assert.ok(typeof rawLemma === "string" && rawLemma.trim(), `Morphology analysis for ${surface} has no lemma`);
      const lemma = normalizeCatalan(rawLemma);
      assert.ok(lemmas.has(lemma), `Morphology form ${surface} points to missing lemma ${lemma}`);
      mappedLemmas.add(lemma);
    }
    const merged = morphology.get(normalizedSurface) ?? new Set();
    for (const lemma of mappedLemmas) merged.add(lemma);
    morphology.set(normalizedSurface, merged);
  }
  assert.equal(
    morphology.size,
    manifest.morphologyFormCount,
    "manifest.morphologyFormCount must equal the merged source-layer surface union",
  );
  const coreLemmaKeys = new Set(coreLex.map((entry) => normalizeCatalan(packedNormalizedLemma(entry))));
  for (const record of coreMorph) {
    const { surface, analyses } = morphRecord(record);
    for (const analysis of analyses) {
      const rawLemma = analysisLemma(analysis);
      assert.ok(typeof rawLemma === "string" && rawLemma.trim(), `Core morphology ${surface} has no lemma`);
      assert.ok(coreLemmaKeys.has(normalizeCatalan(rawLemma)), `Core morphology ${surface} escapes the core lexicon`);
    }
  }

  const highFrequency = await readLines(resolve(root, "data/qa/high-frequency-lemmas.txt"));
  assert.ok(highFrequency.length >= 300, "The fixed high-frequency gate must contain at least 300 lemmas/expressions");
  const normalizedHighFrequency = highFrequency.map(normalizeCatalan);
  assert.equal(new Set(normalizedHighFrequency).size, normalizedHighFrequency.length, "High-frequency QA rows must be unique");
  const missingHighFrequency = normalizedHighFrequency.filter((lemma) => !lemmas.has(lemma));
  assert.deepEqual(missingHighFrequency, [], `Missing high-frequency lemmas: ${missingHighFrequency.join(", ")}`);
  const highFrequencyEntries = normalizedHighFrequency
    .map((lemma) => lemmas.get(lemma))
    .filter(Boolean);
  const highFrequencyCoverage = (getter) =>
    highFrequencyEntries.filter((entry) => hasContent(getter(entry))).length /
    highFrequencyEntries.length;
  const highFrequencyMeaningCoverage =
    highFrequencyEntries.filter(
      (entry) =>
        hasContent(entry.d?.ca) ||
        hasContent(packedSpanish(entry)) ||
        hasContent(packedChinese(entry)),
    ).length / highFrequencyEntries.length;
  assert.equal(highFrequencyCoverage(packedSources), 1, "Every high-frequency entry must retain source attribution");
  assert.ok(highFrequencyCoverage(packedPartOfSpeech) >= 0.9, "High-frequency POS coverage must be at least 90%");
  assert.ok(highFrequencyCoverage(packedSpanish) >= 0.65, "High-frequency Spanish coverage must be at least 65%");
  assert.ok(highFrequencyMeaningCoverage >= 0.75, "At least 75% of high-frequency entries need a Catalan/Spanish/Chinese meaning");

  const cases = await readMorphologyCases(resolve(root, "data/qa/morphology-cases.tsv"));
  assert.ok(cases.length >= 200, "The fixed morphology gate must contain at least 200 forms");
  const duplicateCases = cases
    .map(({ surface, lemma }) => `${surface}\u0000${lemma}`)
    .filter((key, index, all) => all.indexOf(key) !== index);
  assert.deepEqual(duplicateCases, [], "Morphology QA surface/lemma pairs must be unique");
  const runtimeCompositionCases = cases.filter(
    ({ coverageClass }) => coverageClass === "clitic" || coverageClass === "periphrastic-past",
  );
  const indexedCases = cases.filter((item) => !runtimeCompositionCases.includes(item));
  const missingMorphology = indexedCases.filter(
    ({ surface, lemma }) => !morphology.get(surface)?.has(lemma),
  );
  assert.deepEqual(
    missingMorphology,
    [],
    `Missing morphology mappings: ${missingMorphology.map(({ surface, lemma }) => `${surface}→${lemma}`).join(", ")}`,
  );

  // These samples come from the complete generated data, not the user-provided
  // acceptance vocabulary. A fixed seed makes failures reproducible in CI.
  const randomLemmaEntries = deterministicSample([...lemmas.values()], sampleSize, `${seed}:lemmas`);
  const randomMorphRecords = deterministicSample(
    [...morphology].map(([surface, mappedLemmas]) => [surface, [...mappedLemmas].map((lemma) => [lemma])]),
    sampleSize,
    `${seed}:morphology`,
  );
  const lexicalDescriptorSets = [lexDescriptors, ...lexicalEnrichmentDescriptorSets.map(([, descriptors]) => descriptors)];
  const morphologyDescriptorSets = [morphDescriptors, ...morphologyEnrichmentDescriptorSets.map(([, descriptors]) => descriptors)];
  const randomLemmaSuccesses = randomLemmaEntries.filter((entry) => {
    const normalized = normalizeCatalan(packedNormalizedLemma(entry));
    let routed;
    for (const descriptors of lexicalDescriptorSets) {
      const layerEntry = routeExact(descriptors, recordsByPath, normalized, packedNormalizedLemma);
      if (layerEntry) routed = mergePackedEntry(routed, layerEntry);
    }
    return routed && normalizeCatalan(packedNormalizedLemma(routed)) === normalized;
  }).length;
  const randomMorphologySuccesses = randomMorphRecords.filter((record) => {
    const { surface, analyses } = morphRecord(record);
    const normalizedSurface = normalizeCatalan(surface);
    const expected = new Set(analyses.map((analysis) => normalizeCatalan(analysisLemma(analysis))));
    const routed = new Set();
    for (const descriptors of morphologyDescriptorSets) {
      const layerRecord = routeExact(
        descriptors,
        recordsByPath,
        normalizedSurface,
        (item) => morphRecord(item).surface,
      );
      if (!layerRecord) continue;
      for (const analysis of morphRecord(layerRecord).analyses) {
        const rawLemma = analysisLemma(analysis);
        if (typeof rawLemma === "string" && rawLemma.trim()) routed.add(normalizeCatalan(rawLemma));
      }
    }
    return [...expected].every((lemma) => routed.has(lemma));
  }).length;
  assert.equal(randomLemmaSuccesses, sampleSize, "Random lemma sample did not round-trip");
  assert.equal(randomMorphologySuccesses, sampleSize, "Random morphology sample did not resolve to a shipped lemma");

  const coverageClasses = Object.fromEntries(
    [...new Set(cases.map(({ coverageClass }) => coverageClass))]
      .sort()
      .map((coverageClass) => [
        coverageClass,
        cases.filter((item) => item.coverageClass === coverageClass).length,
      ]),
  );
  const report = {
    schemaVersion: manifest.schemaVersion,
    dataVersion: manifest.dataVersion,
    lemmaCount: lemmas.size,
    morphologyFormCount: morphology.size,
    highFrequency: {
      tested: highFrequency.length,
      found: highFrequency.length - missingHighFrequency.length,
      successRate: 1 - missingHighFrequency.length / highFrequency.length,
      spanishCoverage: highFrequencyCoverage(packedSpanish),
      chineseCoverage: highFrequencyCoverage(packedChinese),
      partOfSpeechCoverage: highFrequencyCoverage(packedPartOfSpeech),
      sourceCoverage: highFrequencyCoverage(packedSources),
      meaningCoverage: highFrequencyMeaningCoverage,
    },
    overallCoverage: {
      spanish: spanishEntries / lemmas.size,
      chinese: chineseEntries / lemmas.size,
      catalanDefinitions: definitionEntries / lemmas.size,
      anyMeaning: meaningEntries / lemmas.size,
      partOfSpeech: partOfSpeechEntries / lemmas.size,
      source: sourcedEntries / lemmas.size,
    },
    fixedMorphology: {
      tested: indexedCases.length,
      found: indexedCases.length - missingMorphology.length,
      successRate: 1 - missingMorphology.length / indexedCases.length,
      coverageClasses,
    },
    runtimeComposition: {
      tested: runtimeCompositionCases.length,
      cases: runtimeCompositionCases,
    },
    random: {
      seed,
      lemmas: { tested: sampleSize, found: randomLemmaSuccesses, successRate: randomLemmaSuccesses / sampleSize },
      morphology: {
        tested: sampleSize,
        found: randomMorphologySuccesses,
        successRate: randomMorphologySuccesses / sampleSize,
      },
      sampledLemmas: randomLemmaEntries.map((entry) => packedLemma(entry)),
      sampledForms: randomMorphRecords.map((record) => {
        const { surface, analyses } = morphRecord(record);
        return { surface, lemma: analysisLemma(analyses[0]) };
      }),
    },
  };

  if (!options.quiet) console.log(JSON.stringify(report, null, 2));
  return report;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  runDictionaryQa().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}

