#!/usr/bin/env python3
"""Export source-bound jobs for every lemma still missing Chinese."""

import argparse
import json
import re
from pathlib import Path

import build_search as b
from bulk_chinese import job_for_evidence, headword_job


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=b.ROOT / "work/bulk-chinese/jobs.jsonl")
    args = parser.parse_args()
    public = b.ROOT / "public"
    manifest = json.loads((public / "dictionary/manifest.json").read_text())
    records, entries = b.collect(public, manifest, b.load_seed(b.ROOT / "lib/dictionary.ts"))
    search = json.loads((public / "dictionary/search/manifest.json").read_text())
    if search["baseDataVersion"] != manifest["dataVersion"]:
        raise ValueError("Search data and base dictionary differ")
    for descriptor in search["chinese"]:
        for overlay in b.read_pack(public, descriptor):
            entries[overlay["n"]] = b.merge(entries[overlay["n"]], overlay)
    jobs, counts = [], {}
    holds_path = b.ROOT / "data/translations/bulk/source-holds.json"
    holds = {(r["normalizedLemma"], r["sourceText"]) for r in json.loads(holds_path.read_text())} if holds_path.exists() else set()
    missing = sorted((e for e in entries.values() if not b.has_chinese(e)),
                     key=lambda e: (e.get("r", 2**53 - 1), e["n"]))
    for entry in missing:
        layers = records[entry["n"]]
        evidence = [e for e in b.source_evidence(layers)
                    if (entry["n"], e["text"]) not in holds
                    if not re.search(r"a aquesta paraula li falten|podeu ajudar el viccionari|rfdef|definition needed|^\* |pertanyent a \.$|pertanyent a (?:o |al o )|desenvolupada per el segle|originari de la ,|Estudiós de o |figures de \.$", e["text"], re.I)]
        selected = [e for e in evidence if e["kind"] == "definition" and e["declaredLanguage"] == "en"]
        catalan = [e for e in evidence if e["kind"] == "definition" and e["declaredLanguage"] == "ca"]
        # A one-word English gloss (e.g. relief) loses the source sense. Prefer
        # a substantive Catalan definition when it supplies the missing context.
        if selected and all(len(e["text"].split()) <= 4 for e in selected) and any(len(e["text"].split()) >= 3 for e in catalan):
            selected = catalan
        if not selected:
            selected = catalan
        if not selected:
            selected = [e for e in evidence if e["kind"] == "translation_hint" and e.get("languageVerified")]
        seen = set()
        chosen = []
        for source in selected:
            identity = (source["declaredLanguage"], source["text"])
            if identity in seen:
                continue
            seen.add(identity)
            chosen.append(job_for_evidence(entry["n"], source))
            if len(chosen) == 3:
                break
        if not chosen:
            chosen = [headword_job(entry, layers)]
        for row in chosen:
            row["baseDataVersion"] = manifest["dataVersion"]
            jobs.append(row)
        kind = chosen[0]["kind"] + ":" + chosen[0]["sourceLanguage"]
        counts[kind] = counts.get(kind, 0) + 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(b"".join(b.canonical(row) + b"\n" for row in jobs))
    summary = {"baseDataVersion": manifest["dataVersion"], "searchDataVersion": search["dataVersion"],
               "missingLemmas": len(missing), "jobs": len(jobs), "lemmaCategories": counts,
               "jobsSha256": b.digest(args.output.read_bytes())}
    args.output.with_suffix(".manifest.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
