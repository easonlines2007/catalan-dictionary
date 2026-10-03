#!/usr/bin/env python3
"""Build deterministic, versioned Catalan dictionary shards.

The runtime data is deliberately lemma-centred. Inflected forms are emitted to
an independent surface -> analyses index and never counted as headwords.
Only Python's standard library is required.
"""

from __future__ import annotations

import argparse
import bz2
import collections
import dataclasses
import gzip
import hashlib
import html
import io
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import tarfile
import unicodedata
import xml.etree.ElementTree as ET


SCHEMA_VERSION = 2
BUILDER_VERSION = "2.0.0"
CORE_LEMMA_TARGET = 5_000
SHARD_TARGET_BYTES = 192 * 1024
SHARD_HARD_LIMIT_BYTES = 256 * 1024
MAX_DEFINITIONS_PER_LANGUAGE = 8
MAX_TRANSLATIONS_PER_LANGUAGE = 12
MAX_ENTRY_FORMS = 24
MAX_EXAMPLES = 4
MAX_ANALYSES_PER_FORM = 16

SOURCE_KAIKKI = "kaikki-enwiktionary-ca"
SOURCE_CURATED = "project-curated"
SOURCE_CAWIKT = "cawiktionary"
SOURCE_APERTIUM_CAT = "apertium-cat"
SOURCE_APERTIUM_SPA_CAT = "apertium-spa-cat"
SOURCE_FREEDICT = "freedict-cat-spa"

ALLOWED_POS = {
    "adjective",
    "adverb",
    "article",
    "conjunction",
    "contraction",
    "determiner",
    "expression",
    "interjection",
    "noun",
    "numeral",
    "particle",
    "preposition",
    "pronoun",
    "verb",
}

KAIKKI_POS = {
    "adj": "adjective",
    "adv": "adverb",
    "article": "article",
    "conj": "conjunction",
    "contraction": "contraction",
    "det": "determiner",
    "intj": "interjection",
    "noun": "noun",
    "num": "numeral",
    "particle": "particle",
    "phrase": "expression",
    "prep": "preposition",
    "prep_phrase": "expression",
    "pron": "pronoun",
    "proverb": "expression",
    "verb": "verb",
}

APERTIUM_POS = {
    "adj": "adjective",
    "adv": "adverb",
    "preadv": "adverb",
    "cnjadv": "conjunction",
    "cnjcoo": "conjunction",
    "cnjsub": "conjunction",
    "det": "determiner",
    "detnt": "determiner",
    "predet": "determiner",
    "ij": "interjection",
    "n": "noun",
    "num": "numeral",
    "ord": "numeral",
    "pr": "preposition",
    "prn": "pronoun",
    "vaux": "verb",
    "vbhaver": "verb",
    "vblex": "verb",
    "vbmod": "verb",
    "vbser": "verb",
}

FREEDICT_POS = {
    "adj": "adjective",
    "adjective": "adjective",
    "adv": "adverb",
    "adverb": "adverb",
    "article": "article",
    "conj": "conjunction",
    "conjunction": "conjunction",
    "det": "determiner",
    "idiom": "expression",
    "interj": "interjection",
    "interjection": "interjection",
    "n": "noun",
    "noun": "noun",
    "num": "numeral",
    "numeral": "numeral",
    "number": "numeral",
    "prep": "preposition",
    "preposition": "preposition",
    "pron": "pronoun",
    "pronoun": "pronoun",
    "proverb": "expression",
    "v": "verb",
    "verb": "verb",
}

CAWIKT_POS_HINTS = (
    ("locucio", "expression"),
    ("expressio", "expression"),
    ("frase", "expression"),
    ("adjectiu", "adjective"),
    ("adverbi", "adverb"),
    ("article", "article"),
    ("conjuncio", "conjunction"),
    ("contraccio", "contraction"),
    ("determinant", "determiner"),
    ("interjeccio", "interjection"),
    ("nom propi", "proper-name"),
    ("substantiu", "noun"),
    ("nom", "noun"),
    ("numeral", "numeral"),
    ("preposicio", "preposition"),
    ("pronom", "pronoun"),
    ("verb", "verb"),
)

MORPH_TAGS = {
    "cni": "conditional",
    "fti": "future indicative",
    "fts": "future subjunctive",
    "ger": "gerund",
    "ifi": "simple past indicative",
    "imp": "imperative",
    "inf": "infinitive",
    "p1": "first person",
    "p2": "second person",
    "p3": "third person",
    "pii": "imperfect indicative",
    "pis": "imperfect subjunctive",
    "pl": "plural",
    "pp": "past participle",
    "pri": "present indicative",
    "prs": "present subjunctive",
    "sg": "singular",
    "f": "feminine",
    "m": "masculine",
    "mf": "common gender",
    "pos": "positive",
    "sup": "superlative",
}

APOSTROPHES = str.maketrans({"’": "'", "‘": "'", "ʼ": "'", "＇": "'", "`": "'", "´": "'"})
HYPHENS = str.maketrans({"‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "−": "-"})
WORD_RE = re.compile(r"[^\W\d_]+(?:['’·-][^\W\d_]+)*", re.UNICODE)
DIRECT_DEFINITION_RE = re.compile(r"^#(?![:*#])\s*(.+)$")
LEVEL_TWO_RE = re.compile(r"^==(?!=)\s*(.*?)\s*==\s*$", re.MULTILINE)
LEVEL_THREE_RE = re.compile(r"^===(?!=)\s*(.*?)\s*===\s*$")
FORM_TEMPLATE_RE = re.compile(
    r"\{\{(?:ca-forma-conj|forma-p|forma-f|forma-flexionada|ca-(?:verb|nom|adj)-forma)\b",
    re.IGNORECASE,
)
CA_CONJ_RE = re.compile(r"\{\{ca-forma-conj\|([^{}]+)\}\}", re.IGNORECASE)
CA_FORM_OF_RE = re.compile(r"\{\{(?:forma-p|forma-f)\|ca\|([^|}]+)", re.IGNORECASE)
TRAD_RE = re.compile(r"\{\{trad(?:\+|-)?\|(es|zh)\|([^|}]+)", re.IGNORECASE)


@dataclasses.dataclass
class EntryAccumulator:
    lemma: str
    normalized: str
    lemma_priority: int
    pos: set[str] = dataclasses.field(default_factory=set)
    genders: set[str] = dataclasses.field(default_factory=set)
    plurals: set[str] = dataclasses.field(default_factory=set)
    chinese: set[str] = dataclasses.field(default_factory=set)
    spanish: set[str] = dataclasses.field(default_factory=set)
    definitions_ca: list[str] = dataclasses.field(default_factory=list)
    definitions_en: list[str] = dataclasses.field(default_factory=list)
    examples: list[dict[str, str]] = dataclasses.field(default_factory=list)
    forms: set[str] = dataclasses.field(default_factory=set)
    ipa: list[str] = dataclasses.field(default_factory=list)
    sources: set[str] = dataclasses.field(default_factory=set)
    frequency: int = 0
    rank: int | None = None
    layers: dict[str, dict[str, object]] = dataclasses.field(default_factory=dict)


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFC", value or "")
    value = value.replace("\ufeff", "").replace("\u200b", "")
    value = value.translate(APOSTROPHES).translate(HYPHENS)
    value = value.replace("ŀl", "l·l").replace("ĿL", "L·L")
    value = re.sub(r"[•∙⋅‧]", "·", value)
    value = re.sub(r"\s+", " ", value.strip())
    return value.lower()


def accent_fold(value: str) -> str:
    folded = "".join(
        ch for ch in unicodedata.normalize("NFD", normalize(value))
        if unicodedata.category(ch) != "Mn"
    )
    return unicodedata.normalize("NFC", folded)


def js_sort_key(value: str) -> tuple[int, ...]:
    """Match JavaScript's UTF-16 code-unit comparison exactly."""
    encoded = value.encode("utf-16-be", "surrogatepass")
    return tuple(int.from_bytes(encoded[index:index + 2], "big") for index in range(0, len(encoded), 2))


def clean_text(value: str, maximum: int = 500) -> str:
    value = html.unescape(unicodedata.normalize("NFC", value or ""))
    value = re.sub(r"\s+", " ", value).strip(" \t\r\n;,")
    if len(value) > maximum:
        value = value[:maximum].rsplit(" ", 1)[0].rstrip(" ,;:") + "…"
    return value


def valid_term(value: str, *, allow_spaces: bool = True) -> bool:
    if not value or len(value) > 120 or "\n" in value or "\r" in value:
        return False
    if not any(unicodedata.category(ch).startswith("L") for ch in value):
        return False
    if any(mark in value for mark in ("{{", "}}", "[[", "]]", "_prefix_", "<", ">")):
        return False
    if not allow_spaces and " " in value:
        return False
    return True


def add_unique(items: list[str], value: str, limit: int) -> None:
    value = clean_text(value)
    if value and value not in items and len(items) < limit:
        items.append(value)


class Builder:
    def __init__(self, root: Path, lock: dict) -> None:
        self.root = root
        self.lock = lock
        self.sources = {source["id"]: source for source in lock["sources"]}
        self.entries: dict[str, EntryAccumulator] = {}
        self.morph: dict[str, set[tuple[str, str, str]]] = collections.defaultdict(set)
        self.morph_layers: dict[str, dict[str, set[tuple[str, str, str]]]] = {
            "apertium": collections.defaultdict(set),
            "wiktionary": collections.defaultdict(set),
        }
        self.stats: collections.Counter[str] = collections.Counter()

    def source_path(self, source_id: str) -> Path:
        return self.root / self.sources[source_id]["path"]

    def verify_sources(self) -> None:
        for source in self.lock["sources"]:
            path = self.root / source["path"]
            if not path.is_file():
                raise FileNotFoundError(f"Missing source {source['id']}: {path}")
            digest = hashlib.sha256()
            with path.open("rb") as handle:
                for block in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(block)
            actual = digest.hexdigest()
            if actual != source["sha256"]:
                raise ValueError(
                    f"Checksum mismatch for {source['id']}: expected {source['sha256']}, got {actual}"
                )
            self.stats[f"source-bytes:{source['id']}"] = path.stat().st_size
            archive = source.get("archive")
            if archive:
                archive_path = self.root / archive["path"]
                if not archive_path.is_file():
                    raise FileNotFoundError(f"Missing source archive {source['id']}: {archive_path}")
                archive_digest = hashlib.sha256()
                with archive_path.open("rb") as handle:
                    for block in iter(lambda: handle.read(1024 * 1024), b""):
                        archive_digest.update(block)
                archive_actual = archive_digest.hexdigest()
                if archive_actual != archive["sha256"]:
                    raise ValueError(
                        f"Archive checksum mismatch for {source['id']}: "
                        f"expected {archive['sha256']}, got {archive_actual}"
                    )

    def upsert(
        self,
        lemma: str,
        source: str,
        pos: str | None = None,
        priority: int = 10,
    ) -> EntryAccumulator | None:
        lemma = clean_text(lemma, 120)
        key = normalize(lemma)
        if not valid_term(key):
            self.stats["rejected-lemmas"] += 1
            return None
        if pos and pos not in ALLOWED_POS:
            return None
        entry = self.entries.get(key)
        if entry is None:
            entry = EntryAccumulator(lemma=lemma, normalized=key, lemma_priority=priority)
            self.entries[key] = entry
        elif priority < entry.lemma_priority:
            entry.lemma = lemma
            entry.lemma_priority = priority
        if pos:
            entry.pos.add(pos)
        entry.sources.add(source)
        return entry

    @staticmethod
    def layer(entry: EntryAccumulator, layer_id: str) -> dict[str, object]:
        return entry.layers.setdefault(
            layer_id,
            {
                "p": set(),
                "g": set(),
                "pl": set(),
                "zh": set(),
                "es": set(),
                "d_ca": [],
                "d_en": [],
                "ex": [],
                "f": set(),
                "ipa": [],
                "s": set(),
            },
        )

    def add_morph(
        self,
        surface: str,
        lemma: str,
        morphology: str = "",
        pos: str = "",
        layer_id: str = "apertium",
    ) -> None:
        surface_key = normalize(surface)
        lemma_key = normalize(lemma)
        if (
            not valid_term(surface_key)
            or not valid_term(lemma_key)
            or surface_key == lemma_key
        ):
            return
        morphology = clean_text(morphology, 180)
        analysis = (lemma_key, morphology, pos or "")
        self.morph[surface_key].add(analysis)
        self.morph_layers[layer_id][surface_key].add(analysis)

    def parse_freedict(self) -> None:
        source = self.source_path(SOURCE_FREEDICT)
        ns = "{http://www.tei-c.org/ns/1.0}"
        for _event, element in ET.iterparse(source, events=("end",)):
            if element.tag != f"{ns}entry":
                continue
            orths = [clean_text(node.text or "", 120) for node in element.findall(f"./{ns}form/{ns}orth")]
            raw_pos = clean_text(element.findtext(f"./{ns}gramGrp/{ns}pos") or "").lower()
            pos = FREEDICT_POS.get(raw_pos)
            if not pos:
                element.clear()
                continue
            genders = {
                clean_text(node.text or "").lower()
                for node in element.findall(f".//{ns}gen")
            }
            definitions = [clean_text(node.text or "") for node in element.findall(f".//{ns}def")]
            translations = [
                clean_text(node.text or "")
                for node in element.findall(f".//{ns}cit[@type='trans']/{ns}quote")
            ]
            pronunciations = [
                clean_text(node.text or "", 120)
                for node in element.findall(f"./{ns}form/{ns}pron")
            ]
            for lemma in orths:
                entry = self.upsert(lemma, SOURCE_FREEDICT, pos, priority=1)
                if entry is None:
                    continue
                layer = self.layer(entry, "freedict")
                layer["p"].add(pos)
                layer["s"].add(SOURCE_FREEDICT)
                for gender in genders:
                    if gender in {"f", "fem", "feminine"}:
                        entry.genders.add("feminine")
                        layer["g"].add("feminine")
                    elif gender in {"m", "masc", "masculine"}:
                        entry.genders.add("masculine")
                        layer["g"].add("masculine")
                for definition in definitions:
                    add_unique(entry.definitions_ca, definition, MAX_DEFINITIONS_PER_LANGUAGE)
                    add_unique(layer["d_ca"], definition, MAX_DEFINITIONS_PER_LANGUAGE)
                for translation in translations:
                    if valid_term(translation):
                        entry.spanish.add(translation)
                        layer["es"].add(translation)
                for pronunciation in pronunciations:
                    add_unique(entry.ipa, pronunciation, 3)
                    add_unique(layer["ipa"], pronunciation, 3)
            self.stats["freedict-records"] += 1
            element.clear()

    def parse_curated(self) -> None:
        records = json.loads(self.source_path(SOURCE_CURATED).read_text(encoding="utf-8"))
        if not isinstance(records, list):
            raise ValueError("data/curated.json must contain a JSON array")
        for record in records:
            lemma = clean_text(record.get("lemma") or "", 120)
            positions = [value for value in record.get("partOfSpeech", []) if value in ALLOWED_POS]
            if not positions:
                continue
            entry = self.upsert(lemma, SOURCE_CURATED, positions[0], priority=0)
            if entry is None:
                continue
            layer = self.layer(entry, "curated")
            layer["s"].add(SOURCE_CURATED)
            for pos in positions:
                entry.pos.add(pos)
                layer["p"].add(pos)
            for value in record.get("chinese", []):
                if valid_term(value):
                    entry.chinese.add(clean_text(value))
                    layer["zh"].add(clean_text(value))
            for value in record.get("spanish", []):
                if valid_term(value):
                    entry.spanish.add(clean_text(value))
                    layer["es"].add(clean_text(value))
            definitions = record.get("definitions") or {}
            for value in definitions.get("ca", []):
                add_unique(entry.definitions_ca, value, MAX_DEFINITIONS_PER_LANGUAGE)
                add_unique(layer["d_ca"], value, MAX_DEFINITIONS_PER_LANGUAGE)
            for value in definitions.get("en", []):
                add_unique(entry.definitions_en, value, MAX_DEFINITIONS_PER_LANGUAGE)
                add_unique(layer["d_en"], value, MAX_DEFINITIONS_PER_LANGUAGE)
            for example in record.get("examples", []):
                packed_example = {
                    language: clean_text(example.get(language) or "", 240)
                    for language in ("ca", "es", "zh")
                    if example.get(language)
                }
                if packed_example.get("ca") and len(entry.examples) < MAX_EXAMPLES:
                    entry.examples.append(packed_example)
                    layer["ex"].append(packed_example)
            self.stats["curated-records"] += 1

    def parse_kaikki(self) -> None:
        source = self.source_path(SOURCE_KAIKKI)
        with source.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                try:
                    record = json.loads(line)
                except json.JSONDecodeError as error:
                    raise ValueError(f"Invalid Kaikki JSON on line {line_number}: {error}") from error
                if record.get("lang_code") != "ca":
                    continue
                word = clean_text(record.get("word") or "", 120)
                pos = KAIKKI_POS.get(record.get("pos") or "")
                senses = record.get("senses") or []
                form_only = bool(senses) and all(
                    sense.get("form_of") or "form-of" in (sense.get("tags") or [])
                    for sense in senses
                )

                if form_only:
                    for sense in senses:
                        morphology = self.kaikki_morphology(sense.get("tags") or [])
                        for target in sense.get("form_of") or []:
                            lemma = target.get("word") if isinstance(target, dict) else str(target)
                            self.add_morph(word, lemma, morphology, pos or "", "wiktionary")
                    self.stats["kaikki-form-records"] += 1
                    continue

                if not pos:
                    continue
                entry = self.upsert(word, SOURCE_KAIKKI, pos, priority=2)
                if entry is None:
                    continue
                layer = self.layer(entry, "wiktionary")
                layer["p"].add(pos)
                layer["s"].add(SOURCE_KAIKKI)

                tags: set[str] = set()
                for sense in senses:
                    tags.update(sense.get("tags") or [])
                    if sense.get("form_of"):
                        continue
                    for gloss in sense.get("glosses") or []:
                        add_unique(entry.definitions_en, gloss, MAX_DEFINITIONS_PER_LANGUAGE)
                        add_unique(layer["d_en"], gloss, MAX_DEFINITIONS_PER_LANGUAGE)
                    for example in sense.get("examples") or []:
                        text = clean_text(example.get("text") or "", 240)
                        if text and len(entry.examples) < MAX_EXAMPLES and {"ca": text} not in entry.examples:
                            entry.examples.append({"ca": text})
                            if len(layer["ex"]) < MAX_EXAMPLES:
                                layer["ex"].append({"ca": text})

                if "masculine" in tags and "feminine" in tags:
                    entry.genders.add("common")
                    layer["g"].add("common")
                elif "masculine" in tags:
                    entry.genders.add("masculine")
                    layer["g"].add("masculine")
                elif "feminine" in tags:
                    entry.genders.add("feminine")
                    layer["g"].add("feminine")

                for sound in record.get("sounds") or []:
                    if sound.get("ipa"):
                        add_unique(entry.ipa, sound["ipa"], 3)
                        add_unique(layer["ipa"], sound["ipa"], 3)

                for form_record in record.get("forms") or []:
                    form = clean_text(form_record.get("form") or "", 120)
                    form_tags = form_record.get("tags") or []
                    if not form or not valid_term(form):
                        continue
                    ignored = {"canonical", "table-tags", "class", "romanization", "unknown"}
                    if set(form_tags) & ignored:
                        continue
                    morphology = self.kaikki_morphology(form_tags)
                    self.add_morph(form, word, morphology, pos, "wiktionary")
                    if pos != "verb" and len(entry.forms) < MAX_ENTRY_FORMS:
                        entry.forms.add(normalize(form))
                        layer["f"].add(normalize(form))
                    if pos != "verb" and "plural" in form_tags:
                        entry.plurals.add(normalize(form))
                        layer["pl"].add(normalize(form))
                self.stats["kaikki-lemma-records"] += 1

    @staticmethod
    def kaikki_morphology(tags: list[str]) -> str:
        ignored = {"form-of", "combined-form", "table-tags", "canonical"}
        values = [tag.replace("-", " ") for tag in tags if tag not in ignored]
        return " · ".join(dict.fromkeys(values))

    def parse_cawiktionary(self) -> None:
        source = self.source_path(SOURCE_CAWIKT)
        with bz2.open(source, "rb") as compressed:
            for _event, page in ET.iterparse(compressed, events=("end",)):
                if not page.tag.endswith("page"):
                    continue
                title = ""
                text = ""
                for child in page.iter():
                    if child.tag.endswith("title"):
                        title = child.text or ""
                    elif child.tag.endswith("text"):
                        text = child.text or ""
                section = self.catalan_section(text)
                if section and ":" not in title:
                    self.parse_cawiktionary_page(title, section)
                    self.stats["cawiktionary-catalan-pages"] += 1
                page.clear()

    @staticmethod
    def catalan_section(text: str) -> str:
        matches = list(LEVEL_TWO_RE.finditer(text))
        for index, match in enumerate(matches):
            heading = accent_fold(re.sub(r"[{}\-]", "", match.group(1)))
            if heading in {"ca", "catala"}:
                end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
                return text[match.end():end]
        return ""

    def parse_cawiktionary_page(self, title: str, section: str) -> None:
        current_pos: str | None = None
        lexical_definition_seen = False
        pending: list[tuple[str, str]] = []

        for line in section.splitlines():
            heading = LEVEL_THREE_RE.match(line.strip())
            if heading:
                current_pos = self.cawiktionary_pos(heading.group(1))
                continue
            definition_match = DIRECT_DEFINITION_RE.match(line)
            if not definition_match or not current_pos:
                continue
            raw_definition = definition_match.group(1)
            for match in CA_CONJ_RE.finditer(raw_definition):
                parts = [clean_text(part) for part in match.group(1).split("|")]
                if parts and parts[0]:
                    pending.append((parts[0], self.cawiktionary_conj_label(parts[1:])))
            for match in CA_FORM_OF_RE.finditer(raw_definition):
                pending.append((clean_text(match.group(1)), "inflected nominal/adjectival form"))
            if FORM_TEMPLATE_RE.search(raw_definition):
                continue
            definition = self.clean_wikitext(raw_definition)
            if definition and len(definition) >= 2 and current_pos in ALLOWED_POS:
                entry = self.upsert(title, SOURCE_CAWIKT, current_pos, priority=0)
                if entry is not None:
                    layer = self.layer(entry, "wiktionary")
                    layer["p"].add(current_pos)
                    layer["s"].add(SOURCE_CAWIKT)
                    add_unique(entry.definitions_ca, definition, MAX_DEFINITIONS_PER_LANGUAGE)
                    add_unique(layer["d_ca"], definition, MAX_DEFINITIONS_PER_LANGUAGE)
                    lexical_definition_seen = True

        for target, morphology in pending:
            self.add_morph(title, target, morphology, current_pos or "", "wiktionary")

        if lexical_definition_seen:
            entry = self.entries.get(normalize(title))
            if entry is not None:
                for language, translation in TRAD_RE.findall(section):
                    translation = self.clean_wikitext(translation)
                    if not valid_term(translation):
                        continue
                    if language.lower() == "es":
                        entry.spanish.add(translation)
                        self.layer(entry, "wiktionary")["es"].add(translation)
                    else:
                        entry.chinese.add(translation)
                        self.layer(entry, "wiktionary")["zh"].add(translation)

    @staticmethod
    def cawiktionary_pos(heading: str) -> str | None:
        key = accent_fold(re.sub(r"\{\{.*?\}\}", "", heading))
        for hint, pos in CAWIKT_POS_HINTS:
            if hint in key:
                return pos
        return None

    @staticmethod
    def cawiktionary_conj_label(parts: list[str]) -> str:
        values: list[str] = []
        mapping = {
            "1": "first person",
            "2": "second person",
            "3": "third person",
            "pres": "present",
            "imperf": "imperfect",
            "fut": "future",
            "cond": "conditional",
            "ind": "indicative",
            "subj": "subjunctive",
            "imp": "imperative",
            "ger": "gerund",
            "part": "past participle",
        }
        for part in parts:
            if part and not part.startswith(("g=", "n=")):
                values.append(mapping.get(part, part))
        return " · ".join(values) or "conjugated verb form"

    @staticmethod
    def clean_wikitext(value: str) -> str:
        value = re.sub(r"<ref\b[^>]*>.*?</ref>|<ref\b[^>]*/>", "", value, flags=re.I | re.S)
        value = re.sub(r"\[\[([^]|#]+)(?:#[^]|]*)?\|([^]]+)\]\]", r"\2", value)
        value = re.sub(r"\[\[([^]|#]+)(?:#[^]]*)?\]\]", r"\1", value)

        def template(match: re.Match[str]) -> str:
            parts = [part.strip() for part in match.group(1).split("|")]
            name = accent_fold(parts[0]) if parts else ""
            if name in {"m", "terme", "enllac", "l"} and len(parts) >= 3:
                return parts[2]
            if name in {"glossa", "sense", "text"} and len(parts) >= 2:
                return parts[-1]
            if name in {"plural", "femeni", "masculi"} and len(parts) >= 2:
                return parts[-1]
            return ""

        previous = None
        while previous != value:
            previous = value
            value = re.sub(r"\{\{([^{}]*)\}\}", template, value)
        value = re.sub(r"<[^>]+>", "", value)
        value = re.sub(r"'{2,5}", "", value)
        value = re.sub(r"\[(?:https?://\S+)\s+([^]]+)\]", r"\1", value)
        return clean_text(value)

    @staticmethod
    def xml_side_text(node: ET.Element | None) -> str:
        if node is None:
            return ""
        pieces: list[str] = []

        def visit(current: ET.Element) -> None:
            if current.text:
                pieces.append(current.text)
            for child in current:
                tag = child.tag.rsplit("}", 1)[-1]
                if tag == "b":
                    pieces.append(" ")
                elif tag not in {"s", "j", "a"}:
                    visit(child)
                if child.tail:
                    pieces.append(child.tail)

        visit(node)
        return clean_text("".join(pieces), 160)

    @staticmethod
    def apertium_entry_pos(entry: ET.Element, paradigm_name: str = "") -> str | None:
        tags = [node.get("n") or "" for node in entry.findall(".//s")]
        for tag in tags:
            if tag in APERTIUM_POS:
                return APERTIUM_POS[tag]
        match = re.search(r"__([^/]+)$", paradigm_name)
        if match:
            return APERTIUM_POS.get(match.group(1))
        return None

    @staticmethod
    def apertium_morphology(tags: list[str]) -> str:
        values = [MORPH_TAGS[tag] for tag in tags if tag in MORPH_TAGS]
        return " · ".join(dict.fromkeys(values))

    def parse_apertium_cat(self) -> None:
        source = self.source_path(SOURCE_APERTIUM_CAT)
        root = ET.parse(source).getroot()
        paradigms: dict[str, list[tuple[str, str, str]]] = {}
        for paradigm in root.findall("./pardefs/pardef"):
            name = paradigm.get("n") or ""
            variants: list[tuple[str, str, str]] = []
            for variant in paradigm.findall("./e"):
                if variant.get("r") == "RL" or variant.find(".//re") is not None:
                    continue
                if variant.find(".//j") is not None:
                    continue
                left = variant.find("./p/l")
                if left is None:
                    left = variant.find("./i")
                suffix = self.xml_side_text(left)
                tags = [node.get("n") or "" for node in variant.findall("./p/r/s")]
                morphology = self.apertium_morphology(tags)
                pos = next((APERTIUM_POS[tag] for tag in tags if tag in APERTIUM_POS), "")
                variants.append((suffix, morphology, pos))
            paradigms[name] = variants

        main = root.find("./section[@id='main']")
        if main is None:
            raise ValueError("Apertium Catalan dictionary has no main section")
        for source_entry in main.findall("./e"):
            lexical_paradigm = ""
            for par in source_entry.findall("./par"):
                candidate = par.get("n") or ""
                if re.search(r"__(?:adj|adv|cnjadv|cnjcoo|cnjsub|det|detnt|ij|n|num|ord|pr|prn|vaux|vbhaver|vblex|vbmod|vbser)$", candidate):
                    lexical_paradigm = candidate
                    break
            pos = self.apertium_entry_pos(source_entry, lexical_paradigm)
            if pos not in ALLOWED_POS:
                continue

            lemma = clean_text(source_entry.get("lm") or "", 120)
            if not lemma:
                lemma = self.xml_side_text(source_entry.find("./p/r"))
            if not lemma:
                lemma = self.xml_side_text(source_entry.find("./i"))
            entry = self.upsert(lemma, SOURCE_APERTIUM_CAT, pos, priority=3)
            if entry is None:
                continue
            layer = self.layer(entry, "apertium")
            layer["p"].add(pos)
            layer["s"].add(SOURCE_APERTIUM_CAT)

            base_node = source_entry.find("./i")
            if base_node is None:
                base_node = source_entry.find("./p/l")
            base = self.xml_side_text(base_node)

            if lexical_paradigm and source_entry.get("r") != "RL":
                for suffix, morphology, variant_pos in paradigms.get(lexical_paradigm, []):
                    surface = f"{base}{suffix}"
                    self.add_morph(surface, lemma, morphology, variant_pos or pos)
                    if pos != "verb" and len(entry.forms) < MAX_ENTRY_FORMS:
                        entry.forms.add(normalize(surface))
                        layer["f"].add(normalize(surface))
                    if pos != "verb" and "plural" in morphology:
                        entry.plurals.add(normalize(surface))
                        layer["pl"].add(normalize(surface))
            elif source_entry.find("./p") is not None and source_entry.get("r") != "RL":
                surface = self.xml_side_text(source_entry.find("./p/l"))
                tags = [node.get("n") or "" for node in source_entry.findall("./p/r/s")]
                self.add_morph(surface, lemma, self.apertium_morphology(tags), pos)
            self.stats["apertium-cat-lemma-records"] += 1
        root.clear()

    def parse_apertium_spanish(self) -> None:
        source = self.source_path(SOURCE_APERTIUM_SPA_CAT)
        root = ET.parse(source).getroot()
        main = root.find("./section[@id='main']")
        if main is None:
            raise ValueError("Apertium bilingual dictionary has no main section")
        for source_entry in main.findall("./e"):
            # spa-cat is left -> right. LR-only entries are intentionally not
            # inverted because their reverse translation is not licensed as an
            # equivalent analysis by the dictionary author.
            if source_entry.get("r") == "LR":
                continue
            pair = source_entry.find("./p")
            if pair is not None:
                spanish = self.xml_side_text(pair.find("./l"))
                catalan = self.xml_side_text(pair.find("./r"))
                tags = [node.get("n") or "" for node in pair.findall("./r/s")]
                if "np" in tags:
                    continue
            else:
                identity = self.xml_side_text(source_entry.find("./i"))
                spanish = identity
                catalan = identity
            key = normalize(catalan)
            entry = self.entries.get(key)
            if entry and valid_term(spanish) and valid_term(catalan):
                entry.spanish.add(spanish)
                entry.sources.add(SOURCE_APERTIUM_SPA_CAT)
                layer = self.layer(entry, "apertium")
                layer["es"].add(spanish)
                layer["s"].add(SOURCE_APERTIUM_SPA_CAT)
                self.stats["apertium-spanish-links"] += 1
        root.clear()

    def apply_frequency(self) -> None:
        corpus = self.root / "work/sources/apertium-cat/corpus/corpus_ca_wp20000.txt"
        surface_counts: collections.Counter[str] = collections.Counter()
        with corpus.open("r", encoding="utf-8") as handle:
            for line in handle:
                for token in WORD_RE.findall(line):
                    surface_counts[normalize(token)] += 1

        for token, count in surface_counts.items():
            if token in self.entries:
                self.entries[token].frequency += count
                continue
            analyses = self.morph.get(token)
            if not analyses:
                continue
            candidate_lemmas = {analysis[0] for analysis in analyses if analysis[0] in self.entries}
            if len(candidate_lemmas) == 1:
                self.entries[next(iter(candidate_lemmas))].frequency += count

    def finalize(self) -> tuple[list[dict], dict[str, list[list[str]]], list[str]]:
        # Morphology may refer to a Wiktionary form page rather than the final
        # lemma. Keep only analyses whose target is a real merged headword.
        clean_morph, dropped = self.clean_morphology(self.morph)
        self.stats["morph-analyses-dropped-missing-lemma"] = dropped

        ordered_entries = sorted(
            self.entries.values(),
            key=lambda entry: (
                -entry.frequency,
                -(bool(entry.definitions_ca) + bool(entry.definitions_en) + bool(entry.spanish)),
                len(entry.normalized),
                entry.normalized,
            ),
        )
        for rank, entry in enumerate(ordered_entries, 1):
            entry.rank = rank

        core_keys = [
            entry.normalized
            for entry in ordered_entries
            if "apertium" in entry.layers
        ][:CORE_LEMMA_TARGET]
        packed = [
            self.pack_entry(entry)
            for entry in sorted(self.entries.values(), key=lambda e: js_sort_key(e.normalized))
        ]
        return packed, clean_morph, core_keys

    def clean_morphology(
        self,
        source: dict[str, set[tuple[str, str, str]]],
    ) -> tuple[dict[str, list[list[str]]], int]:
        clean_morph: dict[str, list[list[str]]] = {}
        dropped = 0
        for surface, analyses in source.items():
            valid = sorted(
                {
                    (lemma, morphology, pos)
                    for lemma, morphology, pos in analyses
                    if lemma in self.entries
                    # Some Apertium multiword entries attach a paradigm to the
                    # first token. A naive XML expansion would otherwise map a
                    # bare surface such as `faig` to every `fer …` expression.
                    # A valid inflection must retain the lemma's structural
                    # word/hyphen separators; productive clitics are handled by
                    # the runtime resolver instead.
                    and lemma.count(" ") == surface.count(" ")
                    and lemma.count("-") == surface.count("-")
                },
                key=lambda item: (
                    -self.entries[item[0]].frequency,
                    item[0],
                    item[1],
                    item[2],
                ),
            )
            dropped += len(analyses) - len(valid)
            if valid:
                clean_morph[surface] = [
                    [value for value in analysis]
                    for analysis in valid[:MAX_ANALYSES_PER_FORM]
                ]
        return clean_morph, dropped

    @staticmethod
    def gender_value(genders: set[str]) -> str | None:
        if "common" in genders or {"masculine", "feminine"}.issubset(genders):
            return "common"
        if "masculine" in genders:
            return "masculine"
        if "feminine" in genders:
            return "feminine"
        return None

    def pack_entry(self, entry: EntryAccumulator) -> dict:
        packed: dict = {
            "l": entry.lemma,
            "n": entry.normalized,
            "s": sorted(entry.sources),
            "r": entry.rank,
        }
        if entry.pos:
            packed["p"] = sorted(entry.pos)
        gender = self.gender_value(entry.genders)
        if gender:
            packed["g"] = gender
        plurals = sorted(value for value in entry.plurals if value != entry.normalized)
        if plurals:
            packed["pl"] = plurals[:MAX_ENTRY_FORMS]
        if entry.chinese:
            packed["zh"] = sorted(entry.chinese)[:MAX_TRANSLATIONS_PER_LANGUAGE]
        if entry.spanish:
            packed["es"] = sorted(
                entry.spanish,
                key=lambda value: (len(value.split()), len(value), value),
            )[:MAX_TRANSLATIONS_PER_LANGUAGE]
        definitions: dict[str, list[str]] = {}
        if entry.definitions_ca:
            definitions["ca"] = entry.definitions_ca
        if entry.definitions_en:
            definitions["en"] = entry.definitions_en
        if definitions:
            packed["d"] = definitions
        if entry.examples:
            packed["ex"] = entry.examples[:MAX_EXAMPLES]
        forms = sorted(value for value in entry.forms if value != entry.normalized)
        if forms:
            packed["f"] = forms[:MAX_ENTRY_FORMS]
        if entry.ipa:
            packed["ipa"] = " · ".join(entry.ipa[:3])
        return packed

    def pack_layer(self, entry: EntryAccumulator, layer_id: str) -> dict | None:
        values = entry.layers.get(layer_id)
        if not values:
            return None
        packed: dict = {"l": entry.lemma, "n": entry.normalized, "r": entry.rank}
        if values["s"]:
            packed["s"] = sorted(values["s"])
        if values["p"]:
            packed["p"] = sorted(values["p"])
        gender = self.gender_value(values["g"])
        if gender:
            packed["g"] = gender
        for source_key, packed_key, limit in (
            ("pl", "pl", MAX_ENTRY_FORMS),
            ("zh", "zh", MAX_TRANSLATIONS_PER_LANGUAGE),
            ("es", "es", MAX_TRANSLATIONS_PER_LANGUAGE),
            ("f", "f", MAX_ENTRY_FORMS),
        ):
            if values[source_key]:
                packed[packed_key] = sorted(values[source_key])[:limit]
        definitions: dict[str, list[str]] = {}
        if values["d_ca"]:
            definitions["ca"] = values["d_ca"][:MAX_DEFINITIONS_PER_LANGUAGE]
        if values["d_en"]:
            definitions["en"] = values["d_en"][:MAX_DEFINITIONS_PER_LANGUAGE]
        if definitions:
            packed["d"] = definitions
        if values["ex"]:
            packed["ex"] = values["ex"][:MAX_EXAMPLES]
        if values["ipa"]:
            packed["ipa"] = " · ".join(values["ipa"][:3])
        return packed


def deterministic_json(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def deterministic_gzip(data: bytes) -> bytes:
    output = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=output, compresslevel=9, mtime=0) as handle:
        handle.write(data)
    return output.getvalue()


def split_records(records: list, key_fn, target_bytes: int = SHARD_TARGET_BYTES) -> list[list]:
    """Split sorted records into deterministic, size-adaptive lexicographic ranges."""
    shards: list[list] = []
    current: list = []
    current_size = 2
    previous_prefix = ""
    for record in records:
        encoded_size = len(deterministic_json(record)) + (1 if current else 0)
        key = key_fn(record)
        prefix = accent_fold(key)[:2]
        # Prefer a prefix boundary near the target, but enforce the hard limit.
        should_split = current and (
            current_size + encoded_size > SHARD_HARD_LIMIT_BYTES
            or (current_size >= target_bytes and prefix != previous_prefix)
        )
        if should_split:
            shards.append(current)
            current = []
            current_size = 2
        current.append(record)
        current_size += encoded_size
        previous_prefix = prefix
    if current:
        shards.append(current)
    return shards


def write_gzip_shards(
    root: Path,
    public_root: str,
    kind: str,
    records: list,
    key_fn,
) -> tuple[list[dict], int, int]:
    descriptors: list[dict] = []
    compressed_total = 0
    raw_total = 0
    for index, shard in enumerate(split_records(records, key_fn)):
        shard_id = f"{kind}-{index:04d}"
        relative = Path(kind) / f"{shard_id}.json.gz"
        raw = deterministic_json(shard)
        compressed = deterministic_gzip(raw)
        destination = root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(compressed)
        first = key_fn(shard[0])
        last = key_fn(shard[-1])
        descriptors.append(
            {
                "id": shard_id,
                "path": f"{public_root}/{relative.as_posix()}",
                "first": first,
                "last": last,
                "entries": len(shard),
                "bytes": len(compressed),
                "rawBytes": len(raw),
                "sha256": hashlib.sha256(compressed).hexdigest(),
            }
        )
        compressed_total += len(compressed)
        raw_total += len(raw)
    return descriptors, compressed_total, raw_total


def write_single_gzip(
    root: Path,
    public_root: str,
    kind: str,
    name: str,
    records: list,
    key_fn,
) -> dict:
    raw = deterministic_json(records)
    compressed = deterministic_gzip(raw)
    relative = Path(kind) / f"{name}.json.gz"
    destination = root / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(compressed)
    return {
        "id": name,
        "path": f"{public_root}/{relative.as_posix()}",
        "first": key_fn(records[0]) if records else "",
        "last": key_fn(records[-1]) if records else "",
        "entries": len(records),
        "bytes": len(compressed),
        "rawBytes": len(raw),
        "sha256": hashlib.sha256(compressed).hexdigest(),
    }


def source_public_metadata(lock: dict) -> list[dict]:
    fields = (
        "id",
        "name",
        "url",
        "revision",
        "sha256",
        "archive",
        "license",
        "attribution",
        "modifications",
        "correspondingSource",
        "role",
    )
    return [
        {key: source[key] for key in fields if key in source}
        for source in lock["sources"]
    ]


def write_corresponding_source(root: Path, destination: Path) -> dict:
    """Publish the exact GPL inputs and build source as a deterministic tar.gz."""
    files = [
        (root / "work/sources/apertium-cat/COPYING", "apertium-cat/COPYING"),
        (
            root / "work/sources/apertium-cat/apertium-cat.cat.metadix",
            "apertium-cat/apertium-cat.cat.metadix",
        ),
        (
            root / "work/sources/apertium-cat/corpus/corpus_ca_wp20000.txt",
            "apertium-cat/corpus/corpus_ca_wp20000.txt",
        ),
        (root / "work/sources/apertium-spa-cat/COPYING", "apertium-spa-cat/COPYING"),
        (
            root / "work/sources/apertium-spa-cat/apertium-spa-cat.spa-cat.metadix",
            "apertium-spa-cat/apertium-spa-cat.spa-cat.metadix",
        ),
        (root / "scripts/dictionary/build.py", "builder/scripts/dictionary/build.py"),
        (root / "scripts/dictionary/README.md", "builder/scripts/dictionary/README.md"),
        (root / "LICENSE", "builder/LICENSE"),
        (root / "data/sources.lock.json", "builder/data/sources.lock.json"),
    ]
    readme = (
        "Apertium corresponding source\n"
        "==============================\n\n"
        "This archive contains the exact GPL-2.0 Apertium source files used by\n"
        "the Catalan Dictionary PWA, both upstream COPYING files, the frequency\n"
        "corpus used for ranking, and the complete standard-library builder.\n"
        "Place the extracted `work/sources` directories at the paths recorded in\n"
        "sources.lock.json, add the separately licensed Wiktionary/FreeDict inputs,\n"
        "then run `python3 scripts/dictionary/build.py`.\n"
    ).encode("utf-8")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as raw_handle:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_handle, compresslevel=9, mtime=0) as gzip_handle:
            with tarfile.open(fileobj=gzip_handle, mode="w", format=tarfile.GNU_FORMAT) as archive:
                for source_path, archive_name in sorted(files, key=lambda pair: pair[1]):
                    info = tarfile.TarInfo(archive_name)
                    info.size = source_path.stat().st_size
                    info.mode = 0o644
                    info.mtime = 0
                    info.uid = info.gid = 0
                    info.uname = info.gname = ""
                    with source_path.open("rb") as source_handle:
                        archive.addfile(info, source_handle)
                info = tarfile.TarInfo("README.txt")
                info.size = len(readme)
                info.mode = 0o644
                info.mtime = 0
                info.uid = info.gid = 0
                info.uname = info.gname = ""
                archive.addfile(info, io.BytesIO(readme))
    payload = destination.read_bytes()
    return {
        "path": "/dictionary/sources/apertium-corresponding-source.tar.gz",
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


COMMON_WORDS = (
    "ser estar tenir haver fer anar venir poder voler dir donar veure saber agafar "
    "pujar baixar arribar tornar quedar semblar trobar posar portar passar deixar "
    "casa carrer cantonada escola universitat classe professor estudiant ordinador "
    "pantalla llibre petit gran millor pitjor sempre encara també gaire prou potser"
).split()


def build_qa(
    packed: list[dict],
    morph_rows: list[list],
    descriptors: dict[str, list[dict]],
    stats: collections.Counter,
    version: str,
) -> dict:
    entries_by_key = {entry["n"]: entry for entry in packed}
    forms = {row[0]: row[1] for row in morph_rows}
    pos_counts: collections.Counter[str] = collections.Counter()
    source_counts: collections.Counter[str] = collections.Counter()
    definitions_ca = definitions_en = spanish = chinese = ipa = 0
    for entry in packed:
        pos_counts.update(entry.get("p", []))
        source_counts.update(entry.get("s", []))
        definitions_ca += bool(entry.get("d", {}).get("ca"))
        definitions_en += bool(entry.get("d", {}).get("en"))
        spanish += bool(entry.get("es"))
        chinese += bool(entry.get("zh"))
        ipa += bool(entry.get("ipa"))
    common = {
        word: {
            "lemma": word in entries_by_key,
            "surface": word in forms,
        }
        for word in COMMON_WORDS
    }
    ambiguous = sum(1 for _surface, analyses in morph_rows if len(analyses) > 1)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "dataVersion": version,
        "seed": "catalan-dictionary-qa-v2",
        "lemmaCount": len(packed),
        "morphologyFormCount": len(morph_rows),
        "morphologyAnalysisCount": sum(len(row[1]) for row in morph_rows),
        "ambiguousFormCount": ambiguous,
        "coverage": {
            "catalanDefinitions": definitions_ca,
            "englishGlosses": definitions_en,
            "spanishTranslations": spanish,
            "chineseTranslations": chinese,
            "pronunciations": ipa,
        },
        "partOfSpeech": dict(sorted(pos_counts.items())),
        "entriesBySource": dict(sorted(source_counts.items())),
        "commonWordCoverage": common,
        "shards": {
            kind: {
                "count": len(items),
                "maxCompressedBytes": max((item["bytes"] for item in items), default=0),
                "maxRawBytes": max((item["rawBytes"] for item in items), default=0),
            }
            for kind, items in descriptors.items()
        },
        "pipeline": dict(sorted(stats.items())),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    root = args.root.resolve()
    lock_path = root / "data/sources.lock.json"
    lock = json.loads(lock_path.read_text(encoding="utf-8"))

    builder = Builder(root, lock)
    print("[dictionary] verifying source checksums", flush=True)
    builder.verify_sources()
    print("[dictionary] parsing FreeDict", flush=True)
    builder.parse_freedict()
    print("[dictionary] parsing project-curated expressions", flush=True)
    builder.parse_curated()
    print("[dictionary] parsing Kaikki", flush=True)
    builder.parse_kaikki()
    print("[dictionary] parsing Catalan Wiktionary", flush=True)
    builder.parse_cawiktionary()
    print("[dictionary] parsing Apertium Catalan", flush=True)
    builder.parse_apertium_cat()
    print("[dictionary] applying Apertium Spanish translations", flush=True)
    builder.parse_apertium_spanish()
    print("[dictionary] ranking from the pinned Catalan corpus", flush=True)
    builder.apply_frequency()
    packed, morphology, core_keys = builder.finalize()
    if len(packed) < 80_000:
        raise ValueError(f"Quality gate failed: expected at least 80,000 lemmas, got {len(packed)}")

    script_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    version_material = deterministic_json(
        {
            "schemaVersion": SCHEMA_VERSION,
            "builderVersion": BUILDER_VERSION,
            "builderSha256": script_hash,
            "sources": [
                {key: value for key, value in source.items() if key != "path"}
                for source in lock["sources"]
            ],
        }
    )
    version = hashlib.sha256(version_material).hexdigest()[:16]
    public_prefix = f"/dictionary/{version}"

    output_parent = root / "public"
    staging = Path(tempfile.mkdtemp(prefix=".dictionary-", dir=output_parent))
    version_root = staging / version
    try:
        print(f"[dictionary] writing version {version}", flush=True)
        core_set = set(core_keys)
        # The main lexicon layer is physically GPL-only. CC enrichments are
        # separate packs and are merged by normalized lemma at runtime.
        apertium_lex: list[dict] = []
        freedict_lex: list[dict] = []
        wiktionary_lex: list[dict] = []
        curated_lex: list[dict] = []
        for entry in sorted(builder.entries.values(), key=lambda item: js_sort_key(item.normalized)):
            for layer_id, destination in (
                ("apertium", apertium_lex),
                ("freedict", freedict_lex),
                ("wiktionary", wiktionary_lex),
                ("curated", curated_lex),
            ):
                layer_entry = builder.pack_layer(entry, layer_id)
                if layer_entry:
                    destination.append(layer_entry)
        core_lex = [entry for entry in apertium_lex if entry["n"] in core_set]
        # Full shards are self-contained. Core is a deliberate high-frequency
        # duplicate so a complete offline install can simply download every
        # descriptor in manifest.lex/manifest.morph.
        full_lex = apertium_lex
        morph_rows = [
            [surface, analyses]
            for surface, analyses in sorted(morphology.items(), key=lambda item: js_sort_key(item[0]))
        ]
        base_morphology, _ = builder.clean_morphology(builder.morph_layers["apertium"])
        base_morph_rows = [
            [surface, analyses]
            for surface, analyses in sorted(
                base_morphology.items(), key=lambda item: js_sort_key(item[0])
            )
        ]
        wiktionary_morphology, _ = builder.clean_morphology(builder.morph_layers["wiktionary"])
        wiktionary_morph_rows = [
            [surface, analyses]
            for surface, analyses in sorted(
                wiktionary_morphology.items(), key=lambda item: js_sort_key(item[0])
            )
        ]
        core_morph_rows: list[list] = []
        for surface, analyses in base_morph_rows:
            core_analyses = [analysis for analysis in analyses if analysis[0] in core_set]
            if core_analyses:
                core_morph_rows.append([surface, core_analyses])

        rank_by_lemma = {entry["n"]: entry["r"] for entry in packed}
        def prefix_rows_for(entries: list[dict]) -> list[list]:
            groups: dict[str, list[str]] = collections.defaultdict(list)
            for entry in entries:
                groups[accent_fold(entry["n"])].append(entry["n"])
            return [
                [key, sorted(set(lemmas), key=lambda lemma: (rank_by_lemma[lemma], js_sort_key(lemma)))]
                for key, lemmas in sorted(groups.items(), key=lambda item: js_sort_key(item[0]))
            ]

        prefix_rows = prefix_rows_for(apertium_lex)
        freedict_prefix_rows = prefix_rows_for(freedict_lex)
        wiktionary_prefix_rows = prefix_rows_for(wiktionary_lex)
        curated_prefix_rows = prefix_rows_for(curated_lex)
        lex_descriptors, lex_bytes, lex_raw = write_gzip_shards(
            version_root, public_prefix, "lex", full_lex, lambda entry: entry["n"]
        )
        morph_descriptors, morph_bytes, morph_raw = write_gzip_shards(
            version_root, public_prefix, "morph", base_morph_rows, lambda row: row[0]
        )
        prefix_descriptors, prefix_bytes, prefix_raw = write_gzip_shards(
            version_root, public_prefix, "prefix", prefix_rows, lambda row: row[0]
        )
        freedict_descriptors, freedict_bytes, freedict_raw = write_gzip_shards(
            version_root,
            public_prefix,
            "enrichment/freedict",
            freedict_lex,
            lambda entry: entry["n"],
        )
        wiktionary_descriptors, wiktionary_bytes, wiktionary_raw = write_gzip_shards(
            version_root,
            public_prefix,
            "enrichment/wiktionary",
            wiktionary_lex,
            lambda entry: entry["n"],
        )
        wiktionary_morph_descriptors, wiktionary_morph_bytes, wiktionary_morph_raw = write_gzip_shards(
            version_root,
            public_prefix,
            "enrichment/wiktionary-morph",
            wiktionary_morph_rows,
            lambda row: row[0],
        )
        freedict_prefix_descriptors, freedict_prefix_bytes, freedict_prefix_raw = write_gzip_shards(
            version_root,
            public_prefix,
            "enrichment/freedict-prefix",
            freedict_prefix_rows,
            lambda row: row[0],
        )
        wiktionary_prefix_descriptors, wiktionary_prefix_bytes, wiktionary_prefix_raw = write_gzip_shards(
            version_root,
            public_prefix,
            "enrichment/wiktionary-prefix",
            wiktionary_prefix_rows,
            lambda row: row[0],
        )
        curated_descriptors, curated_bytes, curated_raw = write_gzip_shards(
            version_root,
            public_prefix,
            "enrichment/curated",
            curated_lex,
            lambda entry: entry["n"],
        )
        curated_prefix_descriptors, curated_prefix_bytes, curated_prefix_raw = write_gzip_shards(
            version_root,
            public_prefix,
            "enrichment/curated-prefix",
            curated_prefix_rows,
            lambda row: row[0],
        )
        core_lex_descriptor = write_single_gzip(
            version_root, public_prefix, "core", "core-lex", core_lex, lambda entry: entry["n"]
        )
        core_morph_descriptor = write_single_gzip(
            version_root, public_prefix, "core", "core-morph", core_morph_rows, lambda row: row[0]
        )

        descriptor_sets = {
            "lex": lex_descriptors,
            "morph": morph_descriptors,
            "prefix": prefix_descriptors,
            "freedict": freedict_descriptors,
            "wiktionary": wiktionary_descriptors,
            "wiktionaryMorph": wiktionary_morph_descriptors,
            "freedictPrefix": freedict_prefix_descriptors,
            "wiktionaryPrefix": wiktionary_prefix_descriptors,
            "curated": curated_descriptors,
            "curatedPrefix": curated_prefix_descriptors,
        }
        qa = build_qa(packed, morph_rows, descriptor_sets, builder.stats, version)
        qa_bytes = deterministic_json(qa)
        qa_path = version_root / "qa.json"
        qa_path.write_bytes(qa_bytes)
        corresponding_source = write_corresponding_source(
            root,
            staging / "sources/apertium-corresponding-source.tar.gz",
        )

        source_bytes = sum(
            builder.stats[f"source-bytes:{source['id']}"] for source in lock["sources"]
        )
        core_compressed = core_lex_descriptor["bytes"] + core_morph_descriptor["bytes"]
        core_raw = core_lex_descriptor["rawBytes"] + core_morph_descriptor["rawBytes"]
        total_compressed = (
            lex_bytes + morph_bytes + prefix_bytes + freedict_bytes + wiktionary_bytes
            + wiktionary_morph_bytes + freedict_prefix_bytes + wiktionary_prefix_bytes
            + curated_bytes + curated_prefix_bytes
            + core_compressed
        )
        total_raw = (
            lex_raw + morph_raw + prefix_raw + freedict_raw + wiktionary_raw
            + wiktionary_morph_raw + freedict_prefix_raw + wiktionary_prefix_raw
            + curated_raw + curated_prefix_raw
            + core_raw
        )
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "dataVersion": version,
            "generatedAt": "2026-08-12T00:00:00Z",
            "lemmaCount": len(packed),
            "baseLemmaCount": len(apertium_lex),
            "morphologyFormCount": len(morph_rows),
            "morphologyAnalysisCount": sum(len(row[1]) for row in morph_rows),
            "baseMorphologyFormCount": len(base_morph_rows),
            "baseMorphologyAnalysisCount": sum(len(row[1]) for row in base_morph_rows),
            "prefixKeyCount": len({accent_fold(entry["n"]) for entry in packed}),
            "basePrefixKeyCount": len(prefix_rows),
            "coreLemmaCount": len(core_lex),
            "coreFormCount": len(core_morph_rows),
            "lex": lex_descriptors,
            "morph": morph_descriptors,
            "prefix": prefix_descriptors,
            "core": {
                "lex": core_lex_descriptor["path"],
                "morph": core_morph_descriptor["path"],
            },
            "coreDescriptors": {
                "lex": core_lex_descriptor,
                "morph": core_morph_descriptor,
            },
            "enrichment": {
                "freedict": freedict_descriptors,
                "wiktionary": wiktionary_descriptors,
                "wiktionaryMorph": wiktionary_morph_descriptors,
                "freedictPrefix": freedict_prefix_descriptors,
                "wiktionaryPrefix": wiktionary_prefix_descriptors,
                "curated": curated_descriptors,
                "curatedPrefix": curated_prefix_descriptors,
            },
            "sizes": {
                "sourceBytes": source_bytes,
                "rawBytes": total_raw,
                "compressedBytes": total_compressed,
                "coreRawBytes": core_raw,
                "coreCompressedBytes": core_compressed,
                "initialRawBytes": core_raw,
                "initialGzipBytes": core_compressed,
                "lexRawBytes": lex_raw,
                "lexCompressedBytes": lex_bytes,
                "morphRawBytes": morph_raw,
                "morphCompressedBytes": morph_bytes,
                "prefixRawBytes": prefix_raw,
                "prefixCompressedBytes": prefix_bytes,
                "freedictRawBytes": freedict_raw,
                "freedictCompressedBytes": freedict_bytes,
                "wiktionaryRawBytes": wiktionary_raw,
                "wiktionaryCompressedBytes": wiktionary_bytes,
                "wiktionaryMorphRawBytes": wiktionary_morph_raw,
                "wiktionaryMorphCompressedBytes": wiktionary_morph_bytes,
                "freedictPrefixRawBytes": freedict_prefix_raw,
                "freedictPrefixCompressedBytes": freedict_prefix_bytes,
                "wiktionaryPrefixRawBytes": wiktionary_prefix_raw,
                "wiktionaryPrefixCompressedBytes": wiktionary_prefix_bytes,
                "curatedRawBytes": curated_raw,
                "curatedCompressedBytes": curated_bytes,
                "curatedPrefixRawBytes": curated_prefix_raw,
                "curatedPrefixCompressedBytes": curated_prefix_bytes,
            },
            "sources": source_public_metadata(lock),
            "licensing": {
                "notice": "/dictionary/notices.json",
                "apertiumCorrespondingSource": corresponding_source,
                "statement": "The packed data is derived and must be redistributed under all applicable source licenses; source and field provenance are retained per entry.",
            },
            "formats": {
                "compression": "gzip",
                "encoding": "utf-8",
                "lex": "sorted JSON array of packed entry objects",
                "morph": "sorted [surface, [[lemma, morphology, partOfSpeech], ...]] rows",
                "prefix": "sorted [accentFoldedKey, normalizedLemma[]] rows",
                "layers": "lex/morph/prefix are GPL-2.0 Apertium only; enrichment.freedict and freedictPrefix are CC-BY-SA-3.0; enrichment.wiktionary, wiktionaryMorph, and wiktionaryPrefix are CC-BY-SA-4.0/GFDL; enrichment.curated and curatedPrefix are CC0-1.0; merge matching keys at runtime",
                "packedEntryFields": {
                    "l": "lemma",
                    "n": "normalizedLemma",
                    "p": "partOfSpeech[]",
                    "g": "gender",
                    "pl": "plural[]",
                    "zh": "chinese[]",
                    "es": "spanish[]",
                    "d": "definitions {ca?, en?, es?, zh?}",
                    "ex": "examples[]",
                    "f": "principal forms[]",
                    "ipa": "pronunciation",
                    "s": "source ids[]",
                    "r": "frequency/quality rank (1 is highest)",
                },
            },
            "qa": {
                "path": f"{public_prefix}/qa.json",
                "bytes": len(qa_bytes),
                "sha256": hashlib.sha256(qa_bytes).hexdigest(),
            },
            "build": {
                "builderVersion": BUILDER_VERSION,
                "builderSha256": script_hash,
                "deterministic": True,
            },
        }
        manifest_bytes = deterministic_json(manifest)
        (staging / "manifest.json").write_bytes(manifest_bytes)
        (staging / "notices.json").write_bytes(
            deterministic_json(
                {
                    "dataset": "Catalan Dictionary PWA offline lexical data",
                    "modifications": "Sources were normalized, merged, deduplicated, ranked, split into lemma-centred lexicon/morphology/prefix packs, and compressed for offline use.",
                    "licenseCompliance": "Reuse must satisfy each source license. No commercial dictionary text is included.",
                    "apertiumCorrespondingSource": corresponding_source,
                    "sources": source_public_metadata(lock),
                }
            )
        )

        target = output_parent / "dictionary"
        backup = output_parent / ".dictionary-previous"
        if backup.exists():
            shutil.rmtree(backup)
        if target.exists():
            target.replace(backup)
        staging.replace(target)
        if backup.exists():
            shutil.rmtree(backup)
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise

    print(
        "[dictionary] complete: "
        f"{len(packed):,} lemmas, {len(morph_rows):,} forms, "
        f"{total_raw:,} raw bytes, {total_compressed:,} gzip bytes",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("[dictionary] interrupted", file=sys.stderr)
        raise SystemExit(130)
