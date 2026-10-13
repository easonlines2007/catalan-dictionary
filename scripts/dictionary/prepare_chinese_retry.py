#!/usr/bin/env python3
"""Prepare untranslated source jobs or an explicitly retained English pivot."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-pivot", action="store_true")
    args = parser.parse_args()
    work = ROOT / "work/bulk-chinese"
    jobs = [json.loads(line) for line in (work / "jobs.jsonl").read_text().splitlines()]
    accepted = {json.loads(line)["jobId"] for line in (work / "results.jsonl").read_text().splitlines()}
    corrections_path = ROOT / "data/translations/bulk/corrections.json"
    corrected = {r["jobId"] for r in json.loads(corrections_path.read_text())} if corrections_path.exists() else set()
    pivots_path = work / "pivot.jsonl"
    pivots = {r["jobId"]: r for r in map(json.loads, pivots_path.read_text().splitlines())} if args.from_pivot and pivots_path.exists() else {}
    pending = []
    for job in jobs:
        if job["jobId"] in accepted or job["jobId"] in corrected:
            continue
        if args.from_pivot and job["jobId"] in pivots:
            pivot = pivots[job["jobId"]]
            language = pivot["targetLanguage"]
            job["translationInput"] = {"language": language, "text": pivot["intermediateText"],
                "route": job["sourceLanguage"] + "→" + language + "→zh-Hans", "engine": "Microsoft Bing Translator"}
        pending.append(job)
    output = work / ("retry-pivot.jobs.jsonl" if args.from_pivot else "retry.jobs.jsonl")
    output.write_text("".join(json.dumps(j, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for j in pending))
    print(json.dumps({"pendingJobs": len(pending), "withEnglishPivot": sum("translationInput" in j for j in pending)}))


if __name__ == "__main__":
    main()
