#!/usr/bin/env python3
"""Bind source-compared fixes and exact taxon references to the current jobs."""
import json
import re
from pathlib import Path
import build_search as b

ROOT = Path(__file__).resolve().parents[2]


def main():
    directory = ROOT / "data/translations/bulk"
    jobs = [json.loads(line) for line in (ROOT / "work/bulk-chinese/jobs.jsonl").read_text().splitlines()]
    by_source = {}
    for job in jobs:
        by_source.setdefault((job["normalizedLemma"], job["sourceText"]), []).append(job)
    corrections = {}
    taxonomy = directory / "sources/taxa.json"
    if taxonomy.exists():
        data = json.loads(taxonomy.read_text())
        taxa = {}
        for row in data["records"]:
            taxa.setdefault(row["name"], []).append(row)
        simplifier = b.ChineseConverter(ROOT / "scripts/dictionary/vendor/opencc")
        for job in jobs:
            text = job["sourceText"]
            # Whole binomial or a short, unqualified common-name gloss. Longer
            # definitions may deliberately describe more than this one taxon.
            match = re.fullmatch(r"(?:([^()]{1,80})\s*)?\(([A-Z][a-z]{2,} [a-z]{3,}(?: [a-z]{3,})?)\)", text)
            name = match[2] if match else text
            if match and match[1] and (job["sourceLanguage"] != "en" or re.search(r"\b(?:especially|or|and|from|used|for|of|with|in|which|that)\b|[;.]", match[1])):
                continue
            if name not in taxa:
                continue
            candidates = taxa[name]
            chinese = {simplifier(r["label"]) for r in candidates if (r.get("language") or "").startswith("zh") and b.HAN.search(r["label"])}
            # Conflicting labels at an exact scientific name require separate
            # research. Missing Chinese labels retain the precise Latin identity.
            if len(chinese) > 1:
                continue
            term = next(iter(chinese)) if chinese else "生物分类名"
            corrections[job["jobId"]] = {"jobId": job["jobId"], "sourceHash": job["sourceHash"],
                "translationZh": f"{term}（学名：{name}）",
                "aliasesZh": [term] if chinese else [],
                "reason": "Exact Wikidata P225 identity; Chinese label where available, otherwise retain the scientific name without inventing a Chinese common name.",
                "evidence": sorted({r["item"] for r in candidates})}
    manual_path = directory / "manual-corrections.json"
    manual = json.loads(manual_path.read_text()) if manual_path.exists() else []
    # A one-word Catalan definition is an explicit synonym reference. Reuse the
    # referenced entry rather than accepting an opaque transliteration. Keep it
    # visibly phrased as a reference, since a polysemous target can be broader.
    public = ROOT / "public"
    base = json.loads((public / "dictionary/manifest.json").read_text())
    _, entries = b.collect(public, base, b.load_seed(ROOT / "lib/dictionary.ts"))
    search = json.loads((public / "dictionary/search/manifest.json").read_text())
    if search["baseDataVersion"] != base["dataVersion"]:
        raise ValueError("Reference search and source dictionary differ")
    for descriptor in search["chinese"]:
        for overlay in b.read_pack(public, descriptor):
            if not overlay.get("zhMachine"):
                entries[overlay["n"]] = b.merge(entries[overlay["n"]], overlay)
    meanings = {n: {"chinese": e.get("zh", []) + e.get("d", {}).get("zh", []), "sourceIds": e.get("s", []), "jobIds": []}
                for n, e in entries.items() if b.has_chinese(e)}
    results_path = ROOT / "work/bulk-chinese/results.jsonl"
    results = {row["jobId"]: row for row in (json.loads(line) for line in results_path.read_text().splitlines())} if results_path.exists() else {}
    manual_by_source = {(r["normalizedLemma"], r["sourceText"]): r for r in manual}
    for job in jobs:
        row = manual_by_source.get((job["normalizedLemma"], job["sourceText"])) or corrections.get(job["jobId"]) or results.get(job["jobId"])
        if row and b.HAN.search(row["translationZh"]):
            target = meanings.setdefault(job["normalizedLemma"], {"chinese": [], "sourceIds": job["sourceIds"], "jobIds": []})
            if row["translationZh"] not in target["chinese"]:
                target["chinese"].append(row["translationZh"])
            target["jobIds"].append(job["jobId"])
    references = {}
    for job in jobs:
        name = b.normalize(job["sourceText"])
        if name not in entries:
            name = name.rstrip(".")
        target = meanings.get(name)
        if (job["kind"] != "definition" or job["sourceLanguage"] != "ca"
                or not re.fullmatch(r"[\w·’'-]+", name) or name == job["normalizedLemma"]
                or name not in entries or not target
                or not set(entries[name].get("p", [])).intersection(job["sourcePartOfSpeech"])):
            continue
        texts = [t for t in target["chinese"] if not t.startswith(("「", "参见", "同「"))][:3]
        if not texts:
            continue
        references[name] = {**target, "chinese": texts}
        corrections[job["jobId"]] = {"jobId": job["jobId"], "sourceHash": job["sourceHash"],
            "translationZh": f"参见「{entries[name]['l']}」：" + "；".join(texts), "aliasesZh": [],
            "reason": "Exact Catalan synonym definition with compatible POS; Chinese is explicitly shown as the referenced entry's meaning, not a claim to disambiguate all target senses.",
            "evidence": [f"data/translations/bulk/sources/chinese-references.json#{name}"]}
    reference_path = directory / "sources/chinese-references.json"
    reference_path.parent.mkdir(parents=True, exist_ok=True)
    reference_path.write_text(json.dumps(references, ensure_ascii=False, sort_keys=True, indent=2) + "\n")
    seen = set()
    for row in manual:
        key = (row["normalizedLemma"], row["sourceText"])
        if key in seen:
            raise ValueError(f"Duplicate correction: {key}")
        seen.add(key)
        matching = by_source.get(key)
        if not matching:
            raise ValueError(f"Correction not present in the selected sources: {key}")
        for job in matching:
            corrections[job["jobId"]] = {"jobId": job["jobId"], "sourceHash": job["sourceHash"],
                "translationZh": row["translationZh"], "reason": row["reason"], "evidence": row.get("evidence", []), "aliasesZh": row.get("aliasesZh", [])}
    output = sorted(corrections.values(), key=lambda r: r["jobId"])
    (directory / "corrections.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"manual": len(manual), "totalCorrections": len(output)}))


if __name__ == "__main__":
    main()
