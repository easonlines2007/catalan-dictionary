#!/usr/bin/env python3
"""Bind source-compared Chinese corrections to exact exported definition evidence.

This does not translate text. A JSON plan must provide normalizedLemma, senses
(the existing translation-batch sense schema), and optional status/issues for
each record. All referenced evidence is read verbatim from definitions.jsonl.
"""

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

from validate_translation import validate_batch

ROOT = Path(__file__).resolve().parents[2]


def canonical_hash(value):
    text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("definitions", type=Path)
    parser.add_argument("plan", type=Path)
    parser.add_argument("batch_id")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data/translations/batches")
    parser.add_argument("--dictionary-version")
    parser.add_argument("--selection", required=True)
    args = parser.parse_args()
    if not args.batch_id or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in args.batch_id):
        parser.error("batch_id must use lowercase letters, numbers and hyphens")

    evidence_by_lemma = {}
    with args.definitions.open(encoding="utf-8") as stream:
        for number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            expected = hashlib.sha256(row["sourceText"].encode("utf-8")).hexdigest()
            if row["sourceHash"] != expected:
                raise ValueError(f"Definition row {number}: invalid source hash")
            key = (row["normalizedLemma"], row["evidenceId"])
            if key in evidence_by_lemma:
                raise ValueError(f"Definition row {number}: duplicate evidence identity {key}")
            evidence_by_lemma[key] = row
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    if not isinstance(plan, list):
        raise ValueError("Correction plan must be an array")
    ordered_plan = []
    seen = set()
    for item in plan:
        lemma = item["normalizedLemma"]
        if lemma in seen:
            raise ValueError(f"Duplicate planned lemma: {lemma}")
        seen.add(lemma)
        if len(item["senses"]) > 3:
            raise ValueError(f"More than three selected senses: {lemma}")
        refs = list(dict.fromkeys(ref for sense in item["senses"] for ref in sense["sourceRefs"]))
        refs += [ref for issue in item.get("issues", []) for ref in issue["sourceRefs"] if ref not in refs]
        rows = [evidence_by_lemma[(lemma, ref)] for ref in refs]
        if not rows:
            raise ValueError(f"No source evidence selected: {lemma}")
        ordered_plan.append((item, rows))
    ordered_plan.sort(key=lambda pair: (not any(row.get("core") for row in pair[1]), min(row["priorityRank"] for row in pair[1]), pair[0]["normalizedLemma"]))

    inputs = []
    outputs = []
    for item, rows in ordered_plan:
        lemma = item["normalizedLemma"]
        part_of_speech = sorted({pos for row in rows for pos in row["partOfSpeech"]})
        record = {
            "id": hashlib.sha256(lemma.encode("utf-8")).hexdigest()[:20],
            "lemma": rows[0]["lemma"],
            "normalizedLemma": lemma,
            "partOfSpeech": part_of_speech,
            "existingChinese": [],
            "priorityRank": min(row["priorityRank"] for row in rows),
            "evidence": [
                {
                    "id": row["evidenceId"], "kind": "definition",
                    "declaredLanguage": row["sourceLanguage"], "text": row["sourceText"],
                    "recordSourceIds": row["sourceIds"], "recordPartOfSpeech": row["partOfSpeech"],
                    "layer": row["layer"],
                }
                for row in rows
            ],
        }
        record["inputHash"] = canonical_hash(record)
        inputs.append(record)
        outputs.append({
            **{key: record[key] for key in ("id", "lemma", "normalizedLemma", "inputHash")},
            "status": item.get("status", "translated"),
            "senses": item["senses"], "issues": item.get("issues", []),
        })
    manifest = json.loads((ROOT / "public/dictionary/manifest.json").read_text(encoding="utf-8"))
    common = {"schemaVersion": 1, "batchId": args.batch_id, "recordCount": len(inputs)}
    input_batch = {
        **common, "dictionaryVersion": args.dictionary_version or manifest["dataVersion"],
        "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "selection": args.selection, "records": inputs,
    }
    output_batch = {**common, "records": outputs}
    errors = validate_batch(input_batch, output_batch)
    if errors:
        raise ValueError("\n".join(errors))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for suffix, value in (("input", input_batch), ("reviewed", output_batch)):
        path = args.output_dir / f"{args.batch_id}.{suffix}.json"
        path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"batchId": args.batch_id, "recordCount": len(inputs), "senseCount": sum(len(record["senses"]) for record in outputs)}))


if __name__ == "__main__":
    main()
