"""Identity and evidence binding for explicitly labelled bulk Chinese output."""

import hashlib
import json
import collections
import gzip
from pathlib import Path
import re

HAN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U000323af]")


JOB_FIELDS = ("normalizedLemma", "kind", "sourceLanguage", "sourceText", "sourceIds", "sourcePartOfSpeech", "layer")


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def identified(value):
    value["sourceHash"] = hashlib.sha256(value["sourceText"].encode()).hexdigest()
    value["jobId"] = hashlib.sha256(canonical({k: value[k] for k in JOB_FIELDS})).hexdigest()
    return value


def job_for_evidence(lemma, evidence):
    return identified({"normalizedLemma": lemma, "kind": evidence["kind"],
                       "sourceLanguage": evidence["declaredLanguage"], "sourceText": evidence["text"],
                       "sourceIds": evidence["recordSourceIds"],
                       "sourcePartOfSpeech": evidence["recordPartOfSpeech"], "layer": evidence["layer"]})


def headword_job(entry, layers):
    return identified({"normalizedLemma": entry["n"], "kind": "headword",
                       "sourceLanguage": "ca", "sourceText": entry["l"],
                       "sourceIds": sorted({s for _, row in layers for s in row.get("s", [])}),
                       "sourcePartOfSpeech": entry.get("p", []), "layer": "merged-headword"})


def load_bulk(directory, entries, records, base_version, evidence_reader, short_terms):
    """Check every published row against actual packs, not just its own hash."""
    path = directory / "manifest.json"
    if not path.exists():
        return {}, {}, {}, None
    manifest_bytes = path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest.get("schemaVersion") != 1 or manifest.get("baseDataVersion") != base_version:
        raise ValueError("Bulk Chinese manifest does not match the base dictionary")
    if manifest.get("reviewStatus") != "machine-translated":
        raise ValueError("Bulk Chinese must retain its machine-translated status")
    if manifest.get("correctionsSha256"):
        corrections = (directory / "corrections.json").read_bytes()
        if hashlib.sha256(corrections).hexdigest() != manifest["correctionsSha256"]:
            raise ValueError("Bulk Chinese corrections checksum mismatch")
    for descriptor in manifest.get("sources", []):
        file = (directory / descriptor["file"]).resolve()
        if directory.resolve() not in file.parents or hashlib.sha256(file.read_bytes()).hexdigest() != descriptor["sha256"]:
            raise ValueError("Bulk Chinese supplemental source checksum mismatch")
    holds_path = directory / "source-holds.json"
    holds = {(r["normalizedLemma"], r["sourceText"]) for r in json.loads(holds_path.read_text())} if holds_path.exists() else set()
    overlays, aliases, expected = {}, {}, {}
    counts = collections.Counter()
    seen = set()
    for descriptor in manifest["files"]:
        file = (directory / descriptor["file"]).resolve()
        if directory.resolve() not in file.parents:
            raise ValueError("Unsafe bulk Chinese input path")
        data = file.read_bytes()
        if hashlib.sha256(data).hexdigest() != descriptor["sha256"] or len(data) != descriptor["bytes"]:
            raise ValueError(f"Bulk Chinese checksum mismatch: {file.name}")
        rows = gzip.decompress(data).decode("utf-8").splitlines()
        if len(rows) != descriptor["rows"]:
            raise ValueError(f"Bulk Chinese row count mismatch: {file.name}")
        for line in rows:
            row = json.loads(line)
            lemma = row.get("normalizedLemma")
            if (lemma, row.get("sourceText")) in holds:
                raise ValueError(f"Held bulk Chinese source sense: {lemma}")
            if lemma not in entries or row.get("baseDataVersion") != base_version:
                raise ValueError(f"Unknown/stale bulk Chinese lemma: {lemma}")
            if lemma not in expected:
                expected[lemma] = {r["jobId"]: r for r in
                    [job_for_evidence(lemma, e) for e in evidence_reader(records[lemma])
                     if (e["kind"] == "definition" and e["declaredLanguage"] in ("ca", "en"))
                     or (e["kind"] == "translation_hint" and e.get("languageVerified"))]
                    + [headword_job(entries[lemma], records[lemma])]}
            source = expected[lemma].get(row.get("jobId"))
            if not source or any(row.get(k) != source[k] for k in (*JOB_FIELDS, "sourceHash")):
                raise ValueError(f"Bulk Chinese evidence differs from committed source packs: {lemma}")
            if row["jobId"] in seen:
                raise ValueError(f"Duplicate bulk Chinese job: {lemma}")
            seen.add(row["jobId"])
            text = row.get("translationZh")
            if (row.get("reviewStatus") != "machine-translated" or not isinstance(text, str)
                    or not HAN.search(text) or len(text) > 2000
                    or re.search(r"待翻译|待补充|\b(?:TODO|TBD)\b|ZXQSEG|QXZ", text, re.I)):
                raise ValueError(f"Invalid bulk Chinese translation: {lemma}")
            counts["sourceSenses"] += 1
            if any(HAN.search(t) for t in entries[lemma].get("zh", []) + entries[lemma].get("d", {}).get("zh", [])):
                counts["preservedExistingChineseSenses"] += 1
                continue
            overlay = overlays.setdefault(lemma, {"l": entries[lemma]["l"], "n": lemma,
                "zh": [], "s": [], "pv": [], "zhMachine": True})
            if text not in overlay["zh"]:
                overlay["zh"].append(text)
            overlay["zhHeadword"] = row["kind"] == "headword" or overlay.get("zhHeadword", False)
            overlay["s"] = sorted(set(overlay["s"] + row["sourceIds"] + [manifest["sourceId"]]))
            overlay["pv"].append({"sourceId": manifest["sourceId"], "sourceEntryId": row["jobId"], "fields": ["chinese"]})
            # Long explanatory definitions are displayed, not tokenized into
            # unrelated reverse-search keywords. All supplied terms are exact.
            supplied = row.get("aliasesZh")
            if supplied is not None:
                if not isinstance(supplied, list) or any(not isinstance(t, str) or not HAN.search(t) or len(t) > 24 or t not in text for t in supplied):
                    raise ValueError(f"Bulk Chinese alias differs from its translation: {lemma}")
                aliases.setdefault(lemma, []).extend(supplied)
            else:
                aliases.setdefault(lemma, []).extend(short_terms(text))
            counts[f"{row['kind']}Senses"] += 1
    counts["importedLemmas"] = len(overlays)
    counts["headwordOnlyLemmas"] = sum(bool(o.get("zhHeadword")) for o in overlays.values())
    gaps_path = directory / "source-gaps.json"
    if gaps_path.exists():
        gaps = json.loads(gaps_path.read_text())
        gap_lemmas = set()
        for gap in gaps:
            lemma = gap.get("normalizedLemma")
            if lemma not in entries or gap.get("baseDataVersion") != base_version:
                raise ValueError("Unknown/stale Chinese source gap")
            candidates = [job_for_evidence(lemma, e) for e in evidence_reader(records[lemma])]
            candidates.append(headword_job(entries[lemma], records[lemma]))
            if not any(all(gap.get(k) == candidate.get(k) for k in (*JOB_FIELDS, "jobId", "sourceHash"))
                       for candidate in candidates):
                raise ValueError("Chinese source gap evidence differs from committed packs")
            if gap.get("status") != "source-insufficient" or lemma in overlays or gap["jobId"] in seen:
                raise ValueError("A Chinese source gap must not be counted as translated")
            gap_lemmas.add(lemma)
        counts["sourceInsufficientLemmas"] = len(gap_lemmas)
    signature = {"manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
                 "importerSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                 "sourceId": manifest["sourceId"], "files": manifest["files"]}
    return overlays, aliases, dict(counts), signature
