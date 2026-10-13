"""Source-bound MCR/COW equivalents; no English pivot or machine translation."""

import collections
import gzip
import hashlib
import json
from pathlib import Path
import re
import unicodedata


SOURCE_ID = "omw-mcr-cow"
POS = {"noun": "n", "verb": "v", "adjective": "a", "adverb": "r"}
HAN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U000323af]")
SYNSET = re.compile(r"^\d{8}-[anrv]$")


def clean_chinese(text):
    # COW marks adjective composition with + (e.g. 心脏收缩+的).
    value = unicodedata.normalize("NFC", text).strip().replace("+的", "的")
    if (not HAN.search(value) or len(value) > 24
            or re.search(r"[+{}<>\n\t；;。！？!?]|待翻译|待补充", value)):
        return None
    return value


def load_sources(directory):
    lock = json.loads((directory / "sources.json").read_text(encoding="utf-8"))
    tables = {}
    for source in lock["files"]:
        data = (directory / source["file"]).read_bytes()
        if (len(data) != source["bytes"]
                or hashlib.sha256(data).hexdigest() != source["sha256"]):
            raise ValueError(f"Wordnet input checksum mismatch: {source['file']}")
        raw = gzip.decompress(data) if source["file"].endswith(".gz") else data
        if (len(raw) != source["sourceBytes"]
                or hashlib.sha256(raw).hexdigest() != source["sourceSha256"]):
            raise ValueError(f"Wordnet source checksum mismatch: {source['file']}")
        if source["id"] not in ("cat", "spa", "cmn"):
            continue
        lemmas = collections.defaultdict(set)
        for line in raw.decode("utf-8").splitlines():
            if not line or line.startswith("#"):
                continue
            fields = line.split("\t")
            if not SYNSET.fullmatch(fields[0]):
                raise ValueError(f"Invalid PWN 3.0 synset: {fields[0]}")
            if fields[1] == f"{source['id']}:lemma" and len(fields) == 3:
                lemmas[fields[0]].add(fields[2])
            elif fields[1] not in (f"{source['id']}:def", f"{source['id']}:exe"):
                raise ValueError(f"Unexpected Wordnet row: {fields[:2]}")
        tables[source["id"]] = lemmas
    exclusions_bytes = (directory / "exclusions.json").read_bytes()
    exclusions = json.loads(exclusions_bytes)
    signature = {**lock, "exclusionsSha256": hashlib.sha256(exclusions_bytes).hexdigest(),
                 "importerSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    return tables, exclusions, signature


def align(entries, records, tables, exclusions, normalize, trusted_layers):
    """Require exact Catalan lemma + POS + same-synset trusted Spanish spelling.

    Spelling comparison deliberately preserves Spanish accents; accent folding
    belongs to user search, not evidence corroboration. Existing Chinese wins.
    """
    ca_lemmas = collections.defaultdict(set)
    for synset, terms in tables["cat"].items():
        for term in terms:
            ca_lemmas[normalize(term)].add(synset)
    blocked_senses = {(r["lemma"], r["synset"]) for r in exclusions["senses"]}
    blocked_terms = {(r["synset"], r["term"]) for r in exclusions["terms"]}
    overlays, aliases, evidence = {}, {}, []
    counts = collections.Counter()
    for lemma, entry in sorted(entries.items()):
        if any(HAN.search(t) for t in entry.get("zh", []) + entry.get("d", {}).get("zh", [])):
            continue
        allowed_pos = {POS[p] for p in entry.get("p", []) if p in POS}
        trusted = collections.defaultdict(set)
        for layer, row in records[lemma]:
            if layer not in trusted_layers:
                continue
            for text in row.get("es", []):
                for term in re.split(r"\s*[/；;]\s*", text):
                    if term.strip():
                        trusted[normalize(term)].update(row.get("s", []))
        senses = []
        for synset in sorted(ca_lemmas.get(lemma, [])):
            if synset[-1] not in allowed_pos or synset not in tables["cmn"]:
                continue
            counts["candidateSenses"] += 1
            corroborated = sorted({normalize(t) for t in tables["spa"].get(synset, [])} & trusted.keys())
            if not corroborated:
                counts["uncorroboratedSenses"] += 1
                continue
            if (lemma, synset) in blocked_senses:
                counts["excludedSenses"] += 1
                continue
            terms = sorted({clean_chinese(t) for t in tables["cmn"][synset]
                            if (synset, t) not in blocked_terms} - {None}, key=lambda t: (len(t), t))
            if not terms:
                counts["emptyChineseSenses"] += 1
                continue
            senses.append({"synset": synset, "chinese": terms,
                           "spanishCorroboration": corroborated,
                           "corroboratingSourceIds": sorted({s for t in corroborated for s in trusted[t]})})
        if not senses:
            continue
        # Keep every aligned sense/term in evidence and provenance. Limit visible
        # synonyms per sense, rather than silently dropping distinct senses.
        displayed = list(dict.fromkeys("、".join(s["chinese"][:3]) for s in senses))
        overlays[lemma] = {"l": entry["l"], "n": lemma, "zh": displayed,
                           "zhReference": True, "s": [SOURCE_ID],
                           "pv": [{"sourceId": SOURCE_ID, "sourceEntryId": f"pwn-3.0:{s['synset']}",
                                   "fields": ["chinese"]} for s in senses]}
        aliases[lemma] = sorted({t for s in senses for t in s["chinese"]})
        evidence.append({"normalizedLemma": lemma, "senses": senses})
        counts["alignedSenses"] += len(senses)
    counts["alignedLemmas"] = len(overlays)
    return overlays, aliases, evidence, dict(counts)
