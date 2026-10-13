#!/usr/bin/env python3
"""Build independently versioned reverse indexes from committed dictionary packs.

This never rebuilds or mutates the source dictionary manifest. Only the Python
standard library is required; the small pinned OpenCC dictionaries are vendored.
"""

from __future__ import annotations

import argparse
import collections
import copy
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import unicodedata

from validate_translation import validate_batch
from wordnet import align as align_wordnet, load_sources as load_wordnet_sources
from bulk_chinese import load_bulk


ROOT = Path(__file__).resolve().parents[2]
BUILDER_VERSION = "1.0.0"
SHARD_TARGET_BYTES = 192 * 1024
HAN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U000323af]")
APOSTROPHES = str.maketrans({char: "'" for char in "’‘ʼ＇`´"})
HYPHENS = str.maketrans({char: "-" for char in "‐‑‒–—−"})
# ECMAScript WhiteSpace + LineTerminator, shared with the runtime's /\s+/g.
WHITESPACE = re.compile(r"[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+")
ARRAY_FIELDS = ("p", "pl", "zh", "es", "ex", "f", "s", "pv")
TRUSTED_SPANISH_LAYERS = {"lex", "freedict", "curated", "seed"}
PLACEHOLDER = re.compile(r"待翻译|待补充|未翻译|TODO|TBD|placeholder", re.I)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def utf16_key(value):
    """Descriptor ranges use JavaScript's UTF-16 ordinal string comparison."""
    return value.encode("utf-16-be")


def normalize(value):
    value = unicodedata.normalize("NFC", value).lower()
    value = value.translate(APOSTROPHES).translate(HYPHENS)
    value = value.replace("ŀl", "l·l")
    value = re.sub(r"l[•∙⋅‧]l", "l·l", value)
    return WHITESPACE.sub(" ", value).strip(" ")


def spanish_key(value):
    # Spanish ñ is a separate letter; accents on vowels are optional for search.
    if HAN.search(value):
        value = unicodedata.normalize("NFKC", value)
    chars = []
    for char in unicodedata.normalize("NFD", normalize(value)):
        if "\u0300" <= char <= "\u036f":
            if char == "\u0303" and chars and chars[-1] == "n":
                chars.append(char)
        else:
            chars.append(char)
    return unicodedata.normalize("NFC", "".join(chars))


def chinese_key(value):
    return normalize(unicodedata.normalize("NFKC", value))


def unique(values):
    seen = set()
    result = []
    for item in values:
        key = canonical(item)
        if key not in seen:
            seen.add(key)
            result.append(item)
    return result


def merge(first, other):
    if first is None:
        return copy.deepcopy(other)
    result = copy.deepcopy(first)
    for field in ARRAY_FIELDS:
        values = unique(first.get(field, []) + other.get(field, []))
        if values:
            result[field] = values[:4] if field == "ex" else values[:24] if field == "f" else values
    for lang in ("ca", "en", "es", "zh"):
        values = unique(first.get("d", {}).get(lang, []) + other.get("d", {}).get(lang, []))
        if values:
            result.setdefault("d", {})[lang] = values
    for field in ("g", "ipa"):
        if not result.get(field) and other.get(field):
            result[field] = other[field]
    ranks = [r for r in (first.get("r"), other.get("r")) if isinstance(r, int)]
    if ranks:
        result["r"] = min(ranks)
    if other.get("zhMachine"):
        result["zhMachine"] = True
    if other.get("zhReference"):
        result["zhReference"] = True
    if other.get("zhHeadword"):
        result["zhHeadword"] = True
    return result


def has_chinese(entry):
    return any(HAN.search(text) for text in entry.get("zh", []) + entry.get("d", {}).get("zh", []))


def load_seed(path):
    """Read only the fixed legacy object, without executing arbitrary TS/JS.

    Reject a changed shape instead of silently losing terms. Runtime expressions,
    interpolated strings, or computed properties are deliberately unsupported.
    """
    source = path.read_text(encoding="utf-8")
    block = re.search(r"const LEGACY_CURATED_DICTIONARY[^=]*= \{\n(.*?)\n\};", source, re.S)
    if not block:
        raise ValueError("Cannot locate fixed LEGACY_CURATED_DICTIONARY object")
    starts = list(re.finditer(r'^  (?:"(?:[^"\\]|\\.)*"|[\w]+): \{\n', block[1], re.M))
    if not starts:
        raise ValueError("No seed entries found")
    records = []
    for index, start in enumerate(starts):
        text = block[1][start.start():starts[index + 1].start() if index + 1 < len(starts) else None]
        def field(name):
            hit = re.search(rf'^    {name}: ("(?:[^"\\]|\\.)*"),$', text, re.M)
            if not hit:
                raise ValueError(f"Seed entry has unsupported {name} field: {text[:60]}")
            return json.loads(hit[1])
        lemma = field("lemma")
        examples = [json.loads('{"ca":' + ca + ',"zh":' + zh + '}')
                    for ca, zh in re.findall(r'\{ ca: ("(?:[^"\\]|\\.)*"), zh: ("(?:[^"\\]|\\.)*") \}', text)]
        records.append({"l": lemma, "n": normalize(lemma), "p": [field("partOfSpeech")],
                        "zh": [v.strip() for v in field("zh").split("；") if v.strip()],
                        "es": [v.strip() for v in field("es").split("/") if v.strip()],
                        "ex": examples, "s": ["project-curated"]})
    if len(records) != block[1].count("\n    lemma:"):
        raise ValueError("Seed parser did not consume every lemma")
    return records


class ChineseConverter:
    """Longest-match aliases using pinned OpenCC t2s/s2t tables.

    This intentionally does not claim to implement every OpenCC segmentation
    mode. Original spellings are indexed too, so conversion never erases them.
    """
    def __init__(self, directory, direction="t2s"):
        if direction not in ("t2s", "s2t"):
            raise ValueError(f"Unsupported Chinese conversion direction: {direction}")
        self.sources = json.loads((directory / "sources.json").read_text())
        self.mapping = {}
        prefix = "TS" if direction == "t2s" else "ST"
        for descriptor in self.sources["files"]:
            data = (directory / descriptor["file"]).read_bytes()
            if digest(data) != descriptor["sha256"]:
                raise ValueError(f"OpenCC checksum mismatch: {descriptor['file']}")
            if descriptor["file"] in (f"{prefix}Characters.txt", f"{prefix}Phrases.txt"):
                for line in data.decode("utf-8").splitlines():
                    if not line.strip() or line.startswith("#"):
                        continue
                    key, values = line.split("\t", 1)
                    self.mapping[key] = values.split(" ")[0]
        self.max_length = max(map(len, self.mapping))

    def __call__(self, value):
        result = []
        offset = 0
        while offset < len(value):
            for width in range(min(self.max_length, len(value) - offset), 0, -1):
                token = value[offset:offset + width]
                if token in self.mapping:
                    result.append(self.mapping[token])
                    offset += width
                    break
            else:
                result.append(value[offset])
                offset += 1
        return "".join(result)


def short_chinese_terms(text):
    # Explicit short equivalents only. No substring/character or prose token index.
    for value in re.split(r"[；;、\n]", text):
        value = re.sub(r"^[（(][^）)]{1,24}[）)]\s*", "", value.strip())
        value = value.strip(" ,，。.；;、")
        if value and len(value) <= 24 and HAN.search(value) and not re.search(r"[。！？!?：:]", value):
            yield value


def spanish_terms(text):
    for value in re.split(r"\s*[/；;]\s*", text):
        value = value.strip()
        if value and len(value) <= 90 and not re.search(r"[\u3400-\u9fff{}<>]|\.{3}", value):
            yield value


def read_pack(public, descriptor):
    path = (public / descriptor["path"].lstrip("/")).resolve()
    if public.resolve() not in path.parents:
        raise ValueError(f"Unsafe pack path: {descriptor['path']}")
    data = path.read_bytes()
    if descriptor.get("sha256") and digest(data) != descriptor["sha256"]:
        raise ValueError(f"Input checksum mismatch: {path}")
    rows = json.loads(gzip.decompress(data))
    if len(rows) != descriptor["entries"]:
        raise ValueError(f"Input row count mismatch: {path}")
    return rows


def collect(public, manifest, seed):
    records = collections.defaultdict(list)
    descriptors = [("lex", manifest["lex"])] + [
        (kind, manifest.get("enrichment", {}).get(kind, []))
        for kind in ("freedict", "wiktionary", "curated")]
    for layer, shards in descriptors:
        for descriptor in shards:
            for row in read_pack(public, descriptor):
                records[row["n"]].append((layer, row))
    # Match runtime priority: seed, curated pack, Apertium, FreeDict, Wiktionary.
    priority = {"seed": 0, "curated": 1, "lex": 2, "freedict": 3, "wiktionary": 4}
    for row in seed:
        records[row["n"]].append(("seed", row))
    entries = {}
    for lemma, layers in records.items():
        entry = None
        for _, row in sorted(layers, key=lambda pair: priority[pair[0]]):
            entry = merge(entry, row)
        entries[lemma] = entry
    return records, entries


def source_evidence(layers):
    evidence = []
    seen = set()
    for layer, row in layers:
        fields = [("definition", lang, text) for lang in ("ca", "en", "es")
                  for text in row.get("d", {}).get(lang, [])]
        fields += [("translation_hint", "es", text) for text in row.get("es", [])]
        for kind, lang, text in fields:
            # Keep per-layer references. Identical text from two layers can have
            # different licenses and must not lose its contributing source IDs.
            key = (kind, lang, text, layer)
            if key in seen:
                continue
            seen.add(key)
            item = {"id": f"e{len(evidence) + 1:03d}", "kind": kind,
                    "declaredLanguage": lang, "text": text,
                    "recordSourceIds": row.get("s", []),
                    "recordPartOfSpeech": row.get("p", []), "layer": layer}
            if kind == "translation_hint":
                item["languageVerified"] = layer in TRUSTED_SPANISH_LAYERS
            evidence.append(item)
    return evidence


def queue_record(entry, layers):
    record = {"id": digest(entry["n"].encode())[:20], "lemma": entry["l"],
              "normalizedLemma": entry["n"], "partOfSpeech": entry.get("p", []),
              "existingChinese": entry.get("zh", []) + entry.get("d", {}).get("zh", []),
              "priorityRank": entry.get("r", 2**53 - 1), "evidence": source_evidence(layers)}
    record["inputHash"] = digest(canonical(record))
    return record


def definition_rows(record):
    for evidence in record["evidence"]:
        if evidence["kind"] != "definition" or evidence["declaredLanguage"] not in {"ca", "en"}:
            continue
        text = evidence["text"]
        yield {"normalizedLemma": record["normalizedLemma"], "lemma": record["lemma"],
               "evidenceId": evidence["id"], "sourceText": text,
               "sourceLanguage": evidence["declaredLanguage"],
               "sourceIds": evidence["recordSourceIds"], "sourceHash": digest(text.encode("utf-8")),
               "partOfSpeech": evidence["recordPartOfSpeech"], "layer": evidence["layer"],
               "priorityRank": record["priorityRank"]}


def evidence_identity(evidence):
    return (evidence["kind"], evidence["declaredLanguage"], evidence["text"],
            evidence["layer"], tuple(sorted(evidence["recordSourceIds"])),
            tuple(sorted(evidence["recordPartOfSpeech"])))


def reviewed_overlays(directory, entries, base_version, records):
    overlays, aliases, batches = {}, {}, []
    for path in sorted(directory.glob("*.reviewed.json")):
        input_path = path.with_name(path.name.replace(".reviewed.json", ".input.json"))
        original = json.loads(input_path.read_text())
        batch = json.loads(path.read_text())
        errors = validate_batch(original, batch)
        if errors:
            raise ValueError(f"{path}: " + "; ".join(errors[:10]))
        if original["dictionaryVersion"] != base_version:
            raise ValueError(f"{path}: stale base dictionary version")
        batches.append({"batchId": batch["batchId"], "inputSha256": digest(input_path.read_bytes()),
                        "reviewedSha256": digest(path.read_bytes()), "recordCount": batch["recordCount"]})
        for record, source in zip(batch["records"], original["records"]):
            lemma = record["normalizedLemma"]
            if lemma not in entries:
                raise ValueError(f"{path}: unknown source lemma {lemma}")
            actual_evidence = {evidence_identity(item) for item in source_evidence(records[lemma])}
            for item in source["evidence"]:
                if evidence_identity(item) not in actual_evidence:
                    raise ValueError(f"{path}: {lemma}/{item['id']}: evidence differs from committed source packs")
            if record["status"] != "translated" or not record["senses"] or lemma not in entries:
                continue
            if has_chinese(entries[lemma]):
                continue
            if lemma in overlays:
                raise ValueError(f"Duplicate reviewed Chinese translation: {lemma}")
            refs = {e["id"]: e for e in source["evidence"]}
            sources = unique([sid for sense in record["senses"] for ref in sense["sourceRefs"]
                              for sid in refs[ref]["recordSourceIds"]])
            overlays[lemma] = {"l": entries[lemma]["l"], "n": lemma,
                               "zh": unique([sense["translationZh"] for sense in record["senses"]]),
                               "s": sources + [batch["batchId"]]}
            aliases[lemma] = unique([term for sense in record["senses"] for term in sense["aliasesZh"]])
    return overlays, aliases, batches


def machine_overlays(path, records, entries, existing_overlays):
    overlays, aliases = {}, {}
    counts = collections.Counter()
    if path is None:
        return overlays, aliases, dict(counts)
    if not path.exists():
        raise ValueError(f"Machine input does not exist: {path}")
    evidence_by_lemma = {}
    seen = set()
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        lemma = row.get("normalizedLemma")
        if lemma not in entries:
            raise ValueError(f"{path}:{number}: unknown lemma")
        if lemma not in evidence_by_lemma:
            evidence_by_lemma[lemma] = {e["evidenceId"]: e for e in definition_rows(queue_record(entries[lemma], records[lemma]))}
        source = evidence_by_lemma[lemma].get(row.get("evidenceId"))
        for field in ("sourceText", "sourceLanguage", "sourceIds", "sourceHash"):
            if not source or row.get(field) != source[field]:
                raise ValueError(f"{path}:{number}: evidence mismatch ({field})")
        text = row.get("translationZh", "")
        if (row.get("reviewStatus") != "machine-translated" or not isinstance(text, str)
                or not HAN.search(text) or PLACEHOLDER.search(text) or len(text) > 2000
                or text.strip() == source["sourceText"].strip()):
            raise ValueError(f"{path}:{number}: invalid machine translation")
        identity = (lemma, row["evidenceId"])
        if identity in seen:
            raise ValueError(f"{path}:{number}: duplicate machine evidence")
        seen.add(identity)
        counts["inputSenses"] += 1
        if has_chinese(entries[lemma]) or lemma in existing_overlays:
            counts["preservedExistingChineseSenses"] += 1
            continue
        overlay = overlays.setdefault(lemma, {"l": entries[lemma]["l"], "n": lemma,
                                              "zh": [], "s": [], "zhMachine": True})
        overlay["zh"] = unique(overlay["zh"] + [text.strip()])
        overlay["s"] = unique(overlay["s"] + source["sourceIds"] + ["project-machine-translation"])
        aliases.setdefault(lemma, []).extend(short_chinese_terms(text))
        counts["importedSenses"] += 1
    counts["importedLemmas"] = len(overlays)
    return overlays, aliases, dict(counts)


def build_indexes(records, entries, aliases, simplifier, traditionalizer):
    indexes = {"zh": collections.defaultdict(set), "es": collections.defaultdict(set)}
    exclusions = collections.Counter()
    def add(lang, lemma, text, kind):
        key = spanish_key(text) if lang == "es" else chinese_key(text)
        if key:
            indexes[lang][key].add((lemma, text, kind))
            if lang == "zh":
                simplified = chinese_key(simplifier(text))
                indexes[lang][simplified].add((lemma, text, kind))
                traditional = chinese_key(traditionalizer(simplifier(text)))
                indexes[lang][traditional].add((lemma, text, kind))
    for lemma, layers in records.items():
        trusted = set()
        for layer, row in layers:
            if layer in TRUSTED_SPANISH_LAYERS:
                for text in row.get("es", []) + row.get("d", {}).get("es", []):
                    for term in spanish_terms(text):
                        trusted.add(spanish_key(term))
                        add("es", lemma, term, "translation")
            if layer == "wiktionary":
                for text in row.get("es", []):
                    exclusions["wiktionarySpanishFields"] += 1
        for layer, row in layers:
            if layer == "wiktionary":
                for text in row.get("es", []):
                    # Only same-lemma corroboration. Global word-list membership
                    # cannot establish that an English homograph is Spanish here.
                    if spanish_key(text) in trusted:
                        exclusions["sameLemmaCorroborated"] += 1
                    else:
                        exclusions["excludedUnverifiedLanguage"] += 1
        if lemma in aliases:
            for text in unique(aliases[lemma]):
                add("zh", lemma, text, "alias")
        else:
            for text in entries[lemma].get("zh", []) + entries[lemma].get("d", {}).get("zh", []):
                for term in short_chinese_terms(text):
                    add("zh", lemma, term, "translation")
    rows = {}
    for lang, terms in indexes.items():
        def posting_key(item):
            lemma, term, kind = item
            return (entries[lemma].get("r", 2**53 - 1), utf16_key(lemma), utf16_key(term), kind)
        rows[lang] = [[key, [list(item) for item in sorted(values, key=posting_key)]]
                      for key, values in sorted(terms.items(), key=lambda pair: utf16_key(pair[0]))]
    return rows, dict(exclusions)


def write_atomic(path, data, immutable=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if immutable and path.exists():
        if path.read_bytes() != data:
            raise ValueError(f"Refusing to change immutable output: {path}")
        return
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def write_pack(public, version, kind, name, rows, key):
    raw = canonical(rows)
    buffer = io.BytesIO()
    with gzip.GzipFile(filename="", fileobj=buffer, mode="wb", compresslevel=9, mtime=0) as handle:
        handle.write(raw)
    data = buffer.getvalue()
    path = f"/dictionary/search/{version}/{name}.json.gz"
    write_atomic(public / path.lstrip("/"), data, immutable=True)
    return {"id": name, "path": path, "kind": kind, "entries": len(rows),
            "first": key(rows[0]) if rows else "", "last": key(rows[-1]) if rows else "",
            "bytes": len(data), "rawBytes": len(raw), "sha256": digest(data)}


def write_shards(public, version, kind, name, rows, key):
    groups, current, length = [], [], 2
    for row in rows:
        size = len(canonical(row)) + 1
        if current and length + size > SHARD_TARGET_BYTES:
            groups.append(current)
            current, length = [], 2
        current.append(row)
        length += size
    if current:
        groups.append(current)
    return [write_pack(public, version, kind, f"{name}/{index:04d}", group, key)
            for index, group in enumerate(groups)]


def write_queue(directory, records, entries, core_lemmas, machine_lemmas):
    directory.mkdir(parents=True, exist_ok=True)
    missing = sorted((entry for entry in entries.values() if not has_chinese(entry)),
                     key=lambda entry: (entry["n"] not in core_lemmas, entry.get("r", 2**53 - 1), entry["n"]))
    counters = collections.Counter()
    paths = {name: (directory / f"{name}.jsonl").open("wb")
             for name in ("missing-chinese", "definitions", "input", "spanish-hints", "needs-source", "machine-review")}
    try:
        for entry in missing:
            record = queue_record(entry, records[entry["n"]])
            definitions = list(definition_rows(record))
            paths["missing-chinese"].write(canonical(record) + b"\n")
            for row in definitions:
                row["core"] = entry["n"] in core_lemmas
                paths["definitions"].write(canonical(row) + b"\n")
                counters["definitionSenses"] += 1
            preferred_language = "en" if any(row["sourceLanguage"] == "en" for row in definitions) else "ca"
            for row in definitions:
                if row["sourceLanguage"] == preferred_language:
                    paths["input"].write(canonical(row) + b"\n")
                    counters["preferredDefinitionSenses"] += 1
            for evidence in record["evidence"]:
                if evidence["kind"] == "translation_hint" and evidence.get("languageVerified"):
                    paths["spanish-hints"].write(canonical({"normalizedLemma": entry["n"],
                        "evidenceId": evidence["id"], "sourceText": evidence["text"],
                        "sourceLanguage": "es", "sourceIds": evidence["recordSourceIds"],
                        "sourceHash": digest(evidence["text"].encode("utf-8")),
                        "core": entry["n"] in core_lemmas}) + b"\n")
            if definitions:
                counters["missingWithDefinitions"] += 1
            elif any(e.get("languageVerified") for e in record["evidence"]):
                counters["missingWithSpanishHintsOnly"] += 1
            else:
                counters["missingWithoutReliableEvidence"] += 1
                paths["needs-source"].write(canonical(record) + b"\n")
        for lemma in sorted(machine_lemmas):
            paths["machine-review"].write(canonical({"normalizedLemma": lemma,
                                                    "chinese": entries[lemma]["zh"],
                                                    "reviewStatus": "machine-translated"}) + b"\n")
    finally:
        for handle in paths.values():
            handle.close()
    return dict(counters)


def build(args):
    public = args.root / "public"
    source_bytes = (public / "dictionary/manifest.json").read_bytes()
    manifest = json.loads(source_bytes)
    seed_path = args.root / "lib/dictionary.ts"
    seed = load_seed(seed_path)
    records, entries = collect(public, manifest, seed)
    core_rows = read_pack(public, manifest["coreDescriptors"]["lex"])
    core_lemmas = {row["n"] for row in core_rows} | {row["n"] for row in seed}
    existing_count = sum(has_chinese(entry) for entry in entries.values())
    reviewed, aliases, batches = reviewed_overlays(args.root / "data/translations/batches", entries, manifest["dataVersion"], records)
    machine, machine_aliases, machine_stats = machine_overlays(args.machine_input, records, entries, reviewed)
    overlays = {**reviewed, **machine}
    aliases.update(machine_aliases)
    for lemma, overlay in overlays.items():
        entries[lemma] = merge(entries[lemma], overlay)
    wordnet_directory = args.root / "scripts/dictionary/vendor/omw"
    wordnet_tables, wordnet_exclusions, wordnet_signature = load_wordnet_sources(wordnet_directory)
    wordnet, wordnet_aliases, wordnet_evidence, wordnet_stats = align_wordnet(
        entries, records, wordnet_tables, wordnet_exclusions, normalize, TRUSTED_SPANISH_LAYERS)
    overlays.update(wordnet)
    aliases.update(wordnet_aliases)
    for lemma, overlay in wordnet.items():
        entries[lemma] = merge(entries[lemma], overlay)
    bulk, bulk_aliases, bulk_stats, bulk_signature = load_bulk(
        args.root / "data/translations/bulk", entries, records, manifest["dataVersion"],
        source_evidence, short_chinese_terms)
    overlays.update(bulk)
    aliases.update(bulk_aliases)
    for lemma, overlay in bulk.items():
        entries[lemma] = merge(entries[lemma], overlay)
    simplifier = ChineseConverter(args.root / "scripts/dictionary/vendor/opencc")
    traditionalizer = ChineseConverter(args.root / "scripts/dictionary/vendor/opencc", "s2t")
    indexes, exclusions = build_indexes(records, entries, aliases, simplifier, traditionalizer)
    signature = {"builderVersion": BUILDER_VERSION, "builderSha256": digest(Path(__file__).read_bytes()),
                 "baseManifestSha256": digest(source_bytes), "seedSha256": digest(seed_path.read_bytes()),
                 "batches": batches, "opencc": simplifier.sources, "wordnet": wordnet_signature,
                 "bulkChinese": bulk_signature,
                 "machineInputSha256": digest(args.machine_input.read_bytes()) if args.machine_input else None}
    version = digest(canonical(signature))[:16]
    core = {"entries": write_pack(public, version, "search-core", "core/entries",
                                  [entries[n] for n in sorted(core_lemmas, key=utf16_key)], lambda row: row["n"])}
    for lang in ("zh", "es"):
        core_index = [[key, [posting for posting in postings if posting[0] in core_lemmas]]
                      for key, postings in indexes[lang]]
        core_index = [row for row in core_index if row[1]]
        core[lang] = write_pack(public, version, f"search-{lang}", f"core/{lang}", core_index, lambda row: row[0])
    index_descriptors = {lang: write_shards(public, version, f"search-{lang}", f"indexes/{lang}",
                                          indexes[lang], lambda row: row[0]) for lang in ("zh", "es")}
    chinese = write_shards(public, version, "search-chinese", "chinese", [overlays[n] for n in sorted(overlays, key=utf16_key)], lambda row: row["n"])
    full = list(core.values()) + index_descriptors["zh"] + index_descriptors["es"] + chinese
    queue_counts = write_queue(args.queue_dir, records, entries, core_lemmas, {**machine, **bulk})
    coverage = {"lemmaCount": len(entries), "coreLemmaCount": len(core_lemmas),
                "originalChineseLemmas": existing_count, "reviewedChineseLemmas": len(reviewed),
                "machineChineseLemmas": len(machine) + len(bulk),
                "bulkChinese": bulk_stats,
                "wordnetChineseLemmas": len(wordnet), "wordnetAlignment": wordnet_stats,
                "chineseLemmas": sum(has_chinese(entry) for entry in entries.values()),
                "coreChineseLemmas": sum(has_chinese(entries[n]) for n in core_lemmas),
                "missingChineseLemmas": sum(not has_chinese(entry) for entry in entries.values()),
                "reverseSpanishLemmas": len({p[0] for _, ps in indexes["es"] for p in ps}),
                "reverseChineseLemmas": len({p[0] for _, ps in indexes["zh"] for p in ps}),
                "indexTerms": {lang: len(rows) for lang, rows in indexes.items()},
                "queue": queue_counts, "machineImport": machine_stats,
                "note": "Presence counts do not establish translation quality or complete sense coverage."}
    output = {"schemaVersion": 1, "dataVersion": version, "baseDataVersion": manifest["dataVersion"],
              "core": core, "indexes": index_descriptors, "chinese": chinese,
              "offline": {"core": list(core.values()), "full": full},
              "sizes": {"compressedBytes": sum(d["bytes"] for d in full),
                        "rawBytes": sum(d["rawBytes"] for d in full),
                        "coreCompressedBytes": sum(d["bytes"] for d in core.values())},
              "coverage": coverage, "excludedSpanish": exclusions, "build": signature,
              "formats": {"reverse": "[normalizedTerm, [[normalizedLemma, matchedTerm, translation|alias], ...]]",
                          "entries": "PackedDictionaryEntry[]; zhMachine=true identifies machine-assisted translations; zhHeadword=true identifies headword-only term references",
                          "spanishKey": "NFC lowercase, punctuation/space normalization, accent fold except ñ",
                          "chineseKey": "NFKC lowercase and space normalization; original, OpenCC t2s and s2t aliases"},
              "licensing": {"notice": "/dictionary/notices.json", "sourceLicenses": manifest["sources"],
                            "openccLicense": "/dictionary/search/opencc-license.txt",
                            "wordnetLicenses": ["/dictionary/search/mcr-license.txt", "/dictionary/search/cow-license.txt", "/dictionary/search/wordnet-license.txt"],
                            "statement": "Merged core and reverse indexes retain all applicable source licenses. Chinese translations inherit the licenses of their evidence; machine-translated is not human approval."}}
    write_atomic(public / "dictionary/search/opencc-license.txt", (args.root / "scripts/dictionary/vendor/opencc/LICENSE").read_bytes())
    for name in ("mcr-license.txt", "cow-license.txt", "wordnet-license.txt"):
        write_atomic(public / "dictionary/search" / name, (wordnet_directory / name).read_bytes())
    write_atomic(public / "dictionary/search/manifest.json", canonical(output) + b"\n")
    write_atomic(args.queue_dir / "wordnet-alignment.jsonl", b"".join(canonical(row) + b"\n" for row in wordnet_evidence))
    write_atomic(args.queue_dir / "coverage.json", json.dumps(coverage, ensure_ascii=False, indent=2).encode() + b"\n")
    print(json.dumps({"dataVersion": version, "coverage": coverage, "excludedSpanish": exclusions,
                      "sizes": output["sizes"]}, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--queue-dir", type=Path)
    parser.add_argument("--machine-input", type=Path,
                        help="Explicit opt-in for source-bound, unreviewed MT drafts; omitted by default")
    args = parser.parse_args()
    args.root = args.root.resolve()
    args.queue_dir = args.queue_dir or args.root / "work/translation-queue"
    try:
        build(args)
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as error:
        print(f"Search data build failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
