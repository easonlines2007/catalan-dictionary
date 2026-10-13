#!/usr/bin/env python3
"""Pin Wikidata labels using exact P225 taxon names from lexical definitions.

This optional online preparation step is separate from the offline builder.
No fuzzy search, guessed common name, or machine transliteration is accepted.
"""
import argparse
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENDPOINT = "https://query.wikidata.org/sparql"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jobs", type=Path, default=ROOT / "work/bulk-chinese/jobs.jsonl")
    parser.add_argument("--output", type=Path, default=ROOT / "data/translations/bulk/sources/taxa.json")
    parser.add_argument("--cached-only", action="store_true", help="Package already retrieved responses; make no requests")
    args = parser.parse_args()
    names = set()
    for line in args.jobs.read_text().splitlines():
        row = json.loads(line)
        if row["kind"] != "definition":
            continue
        names.update(re.findall(r"\(([A-Z][a-z]{2,} [a-z]{3,}(?: [a-z]{3,})?)\)", row["sourceText"]))
        if re.fullmatch(r"[A-Z][a-z]{2,} [a-z]{3,}", row["sourceText"]):
            names.add(row["sourceText"])
    cache = ROOT / "work/bulk-chinese/taxa-responses"
    cache.mkdir(parents=True, exist_ok=True)
    records, responses = [], []
    ordered = sorted(names)
    if args.cached_only:
        for path in sorted(cache.glob("*.json")):
            raw = path.read_bytes()
            responses.append({"querySha256": path.stem, "responseSha256": hashlib.sha256(raw).hexdigest()})
            for binding in json.loads(raw)["results"]["bindings"]:
                if binding["scientificName"]["value"] not in names:
                    continue
                record = {"name": binding["scientificName"]["value"],
                          "item": binding["item"]["value"].replace("http:", "https:"),
                          "label": binding["itemLabel"]["value"],
                          "language": binding["itemLabel"].get("xml:lang")}
                if record not in records:
                    records.append(record)
    for start in range(0, len(ordered), 30):
        if args.cached_only:
            break
        group = ordered[start:start + 30]
        query = ("SELECT ?item ?itemLabel ?scientificName WHERE { VALUES ?scientificName { "
                 + " ".join(json.dumps(n) for n in group)
                 + ' } ?item wdt:P225 ?scientificName . SERVICE wikibase:label { bd:serviceParam wikibase:language "zh-hans,zh,zh-hant,en". } }')
        key = hashlib.sha256(query.encode()).hexdigest()
        path = cache / (key + ".json")
        if not path.exists():
            url = ENDPOINT + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
            request = urllib.request.Request(url, headers={"Accept": "application/sparql-results+json", "User-Agent": "CatalanDictionarySourceEnrichment/1.0 (https://github.com/easonlines2007/catalan-dictionary)"})
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(request, timeout=55) as response:
                        raw = response.read()
                    break
                except urllib.error.HTTPError as error:
                    if error.code not in (502, 503, 504) or attempt == 2:
                        print(f"Stopped at {start}: {error}", flush=True)
                        raise
                    time.sleep(2 ** (attempt + 1))
            json.loads(raw)
            path.write_bytes(raw)
            time.sleep(1)
        raw = path.read_bytes()
        responses.append({"querySha256": key, "responseSha256": hashlib.sha256(raw).hexdigest()})
        for binding in json.loads(raw)["results"]["bindings"]:
            records.append({"name": binding["scientificName"]["value"],
                            "item": binding["item"]["value"].replace("http:", "https:"),
                            "label": binding["itemLabel"]["value"],
                            "language": binding["itemLabel"].get("xml:lang")})
        print(json.dumps({"queried": min(start + 30, len(ordered)), "totalNames": len(ordered), "bindings": len(records)}), flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output = {"source": "Wikidata", "property": "P225", "endpoint": ENDPOINT,
              "retrievedOn": "2026-10-12", "license": "CC0-1.0",
              "licenseUrl": "https://www.wikidata.org/wiki/Wikidata:Licensing",
              "candidateNames": ordered, "matchedNames": sorted({r["name"] for r in records}),
              "completeQueryRun": not args.cached_only, "responses": responses,
              "records": sorted(records, key=lambda r: (r["name"], r["item"]))}
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
