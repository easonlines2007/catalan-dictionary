#!/usr/bin/env python3
"""Build small runtime Chinese matching tables from pinned local sources."""
import gzip
import hashlib
import json
from pathlib import Path
import unicodedata

ROOT = Path(__file__).resolve().parents[2]


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
    # Use only the primary reading, tone-free, for conservative typo ranking.
    # This is not contextual pronunciation or a Latin-input pinyin search.
    pronunciations = json.loads(gzip.decompress((vendor / "pinyin/pinyin_dict.json.gz").read_bytes()))
    readings = {}
    for codepoint, values in pronunciations.items():
        first = unicodedata.normalize("NFD", values.split(",")[0]).replace("u\u0308", "v")
        first = "".join(c for c in first if not unicodedata.combining(c))
        readings[chr(int(codepoint))] = first
    output = {"simplified": mapping, "readings": readings, "sources": signatures}
    (root / "lib/chinese-search-data.json").write_text(json.dumps(output, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
    public = root / "public/dictionary/search"
    (public / "pinyin-license.txt").write_bytes((vendor / "pinyin/LICENSE.txt").read_bytes())
    return output


if __name__ == "__main__":
    data = build()
    print(json.dumps({"conversionKeys": len(data["simplified"]), "readings": len(data["readings"])}))
