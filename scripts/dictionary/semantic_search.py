"""Source-bound Chinese concept paraphrases, separate from exact translations."""

import hashlib
import json
from pathlib import Path
import re

HAN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U000323af]")
FIELDS = {"id", "lemma", "label", "expressions", "evidence"}
TRUSTED_SPANISH = {"lex", "freedict", "curated", "seed"}


def build_semantic(path, records, entries, base_version, simplify, chinese_key, utf16_key, indexes):
    raw = path.read_bytes()
    data = json.loads(raw)
    if data.get("schemaVersion") != 1 or data.get("baseDataVersion") != base_version:
        raise ValueError("Chinese semantics: unsupported schema or stale base version")
    if not isinstance(data.get("records"), list):
        raise ValueError("Chinese semantics: records must be an array")
    ids, rows, identities, classes = set(), [], set(), {}
    reverse = dict(indexes["zh"])
    for item in data["records"]:
        if not FIELDS <= set(item) or set(item) - FIELDS - {"partOfSpeech"}:
            raise ValueError("Chinese semantics: invalid concept fields")
        ident, lemma, label = item["id"], item["lemma"], item["label"]
        if not isinstance(ident, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,79}", ident) or ident in ids:
            raise ValueError("Chinese semantics: invalid or duplicate concept ID")
        ids.add(ident)
        part = item.get("partOfSpeech")
        if part is not None and (part not in {"noun", "verb", "adjective", "adverb"}
                                 or part not in entries.get(lemma, {}).get("p", [])):
            raise ValueError(f"Chinese semantics: unsupported source word class {ident}")
        if lemma not in entries or not isinstance(label, str) or not HAN.search(label) or len(label) > 24:
            raise ValueError(f"Chinese semantics: invalid lemma/label {ident}")
        # Suggestion clicks search the label. It must resolve to this exact
        # canonical lemma, even when another dictionary sense shares a word.
        label_key = chinese_key(simplify(label))
        postings = reverse.get(label_key, [])
        if not postings or postings[0][0] != lemma:
            raise ValueError(f"Chinese semantics: label does not select its lemma: {ident}/{label}")
        if not isinstance(item["evidence"], list) or not item["evidence"]:
            raise ValueError(f"Chinese semantics: missing evidence {ident}")
        class_supported = False
        for evidence in item["evidence"]:
            if set(evidence) != {"layer", "field", "text"}:
                raise ValueError(f"Chinese semantics: invalid evidence fields {ident}")
            field = evidence["field"]
            if field not in {"zh", "d.zh", "es", "d.ca", "d.en", "l"}:
                raise ValueError(f"Chinese semantics: unsupported evidence field {ident}")
            if field == "es" and evidence["layer"] not in TRUSTED_SPANISH:
                raise ValueError(f"Chinese semantics: unverified Spanish evidence {ident}")
            values = []
            for layer, record in records[lemma]:
                if layer != evidence["layer"]:
                    continue
                value = record
                for segment in field.split("."):
                    value = value.get(segment, {}) if isinstance(value, dict) else {}
                if isinstance(value, list):
                    values.extend(value)
                elif field == "l" and isinstance(value, str):
                    values.append(value)
                if part in record.get("p", []) and evidence["text"] in (value if isinstance(value, list) else [value]):
                    class_supported = True
            if evidence["text"] not in values:
                raise ValueError(f"Chinese semantic evidence differs from source packs: {ident}")
        if part and not class_supported:
            raise ValueError(f"Chinese semantics: evidence does not support its word class: {ident}")
        expressions = item["expressions"]
        if not isinstance(expressions, list) or not expressions or len(expressions) != len(set(expressions)):
            raise ValueError(f"Chinese semantics: invalid/duplicate expressions {ident}")
        for expression in expressions:
            if not isinstance(expression, str) or not HAN.search(expression) or len(expression) > 64 or re.search(r"[\n\t;；<>]", expression):
                raise ValueError(f"Chinese semantics: invalid expression {ident}")
            key = chinese_key(simplify(expression))
            if part:
                previous = classes.setdefault((key, lemma), part)
                if previous != part:
                    raise ValueError(f"Chinese semantics: conflicting classes for expression/lemma: {ident}")
            identity = (key, lemma, label)
            if identity in identities:
                continue
            identities.add(identity)
            rows.append([key, expression, lemma, label, entries[lemma].get("r", 2**53 - 1), ident] + ([part] if part else []))
    rows.sort(key=lambda row: (utf16_key(row[0]), row[4], utf16_key(row[2]), row[5]))
    signature = {"conceptsSha256": hashlib.sha256(raw).hexdigest(),
                 "builderSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    return rows, {"concepts": len(ids), "expressions": len(rows)}, signature
