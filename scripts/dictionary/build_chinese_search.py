#!/usr/bin/env python3
"""Build small runtime Chinese matching tables from pinned local sources."""
import gzip
import hashlib
import json
from pathlib import Path
import unicodedata

ROOT = Path(__file__).resolve().parents[2]


def toneless(value):
    first = unicodedata.normalize("NFD", value).replace("u\u0308", "v")
    return "".join(c for c in first if not unicodedata.combining(c))


def build(root=ROOT):
    vendor = root / "scripts/dictionary/vendor"
    signatures = {}
    for name in ("opencc", "pinyin"):
        sources = json.loads((vendor / name / "sources.json").read_text())
        for item in sources["files"]:
            raw = (vendor / name / item["file"]).read_bytes()
            actual = hashlib.sha256(raw).hexdigest()
            if actual != item["sha256"]:
                raise ValueError(f"{name}/{item['file']}: checksum mismatch")
            if name == "pinyin" and item["file"].endswith(".gz"):
                if hashlib.sha256(gzip.decompress(raw)).hexdigest() != item["rawSha256"]:
                    raise ValueError("pinyin: uncompressed checksum mismatch")
            signatures[f"{name}/{item['file']}"] = actual
    mapping = {}
    for name in ("TSCharacters.txt", "TSPhrases.txt"):
        for line in (vendor / "opencc" / name).read_text().splitlines():
            if not line or line.startswith("#"):
                continue
            key, value = line.split("\t")
            mapping[key] = value.split(" ")[0]
    # Use one source reading per character/phrase, never all polyphonic choices.
    pronunciations = json.loads(gzip.decompress((vendor / "pinyin/pinyin_dict.json.gz").read_bytes()))
    readings = {}
    for codepoint, values in pronunciations.items():
        readings[chr(int(codepoint))] = toneless(values.split(",")[0])
    source_phrases = json.loads(gzip.decompress((vendor / "pinyin/phrases_dict.json.gz").read_bytes()))
    all_phrases = {key: [toneless(part[0]) for part in values]
                   for key, values in source_phrases.items()
                   if len(key) > 1 and len(key) == len(values) and all(values)}
    exceptions = {key for key, values in all_phrases.items()
                  if values != [readings.get(char) for char in key]}
    by_first = {}
    for key in exceptions:
        by_first.setdefault(key[0], []).append(key)
    # Retain longer default-reading phrases that contain an exception, too:
    # they must block a shorter phrase from changing the source pronunciation.
    phrase_readings = {key: values for key, values in all_phrases.items()
                       if key in exceptions or any(
                           any(key.startswith(phrase, i) for phrase in by_first.get(char, []))
                           for i, char in enumerate(key))}
    output = {"simplified": mapping, "readings": readings,
              "phraseReadings": phrase_readings, "sources": signatures}
    (root / "lib/chinese-search-data.json").write_text(json.dumps(output, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
    public = root / "public/dictionary/search"
    (public / "pinyin-license.txt").write_bytes((vendor / "pinyin/LICENSE.txt").read_bytes())
    return output


if __name__ == "__main__":
    data = build()
    print(json.dumps({"conversionKeys": len(data["simplified"]), "readings": len(data["readings"]),
                      "phraseReadings": len(data["phraseReadings"])}))
