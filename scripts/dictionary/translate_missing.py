#!/usr/bin/env python3
"""Create resumable, explicitly unreviewed Chinese translation candidates offline.

Input is JSONL with normalizedLemma, evidenceId, sourceText, sourceLanguage,
sourceIds and sourceHash (SHA-256 of the exact UTF-8 sourceText). Optional fields
are preserved. This tool never invents definitions for evidence-free lemmas.
It writes intermediate candidates, never production dictionary packs.
Flagged rows go into OUTPUT.issues.jsonl and are excluded from the candidate
output. Both files participate in checkpoint/resume.

Install the small runtime in an ignored directory, for example:
  python3 -m pip install --target work/translation-runtime \
      ctranslate2==4.8.2 sentencepiece==0.2.1
Then pass existing Argos model packages with --en-zh-model and optionally
--ca-en-model. No model or source text is downloaded by this script.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
HAN = re.compile(r"[\u3400-\u9fff]")
GRAMMAR = re.compile(
    r"\b(?:contraction|preposition|article|participle|conjugation|inflection|"
    r"plural of|singular of|alternative form|form of|past tense|present tense|"
    r"feminine of|masculine of|imperative|pronoun)\b",
    re.IGNORECASE,
)


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    with path.open(encoding="utf-8") as stream:
        for number, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{path}:{number}: invalid JSON: {error}") from error
            if not isinstance(row, dict):
                raise ValueError(f"{path}:{number}: expected a JSON object")
            rows.append(row)
    return rows


def validate_row(row: dict[str, Any], number: int) -> None:
    for field in ("normalizedLemma", "evidenceId", "sourceText", "sourceLanguage", "sourceHash"):
        if not isinstance(row.get(field), str) or not row[field].strip():
            raise ValueError(f"Input row {number}: missing or empty {field}")
    if row["sourceLanguage"] not in ("en", "ca", "es"):
        raise ValueError(f"Input row {number}: unsupported source language")
    if not isinstance(row.get("sourceIds"), list) or not row["sourceIds"] or any(
        not isinstance(value, str) or not value for value in row["sourceIds"]
    ):
        raise ValueError(f"Input row {number}: sourceIds must contain source identifiers")
    if row["sourceHash"] != digest(row["sourceText"]):
        raise ValueError(f"Input row {number}: sourceHash does not match exact sourceText")


def row_key(row: dict[str, Any]) -> tuple[str, str, str, str]:
    return tuple(row[field] for field in ("normalizedLemma", "evidenceId", "sourceLanguage", "sourceHash"))


class OfflineModel:
    """Load only the translation model/tokenizer from a local Argos ZIP."""

    def __init__(self, path: Path, expected_pair: tuple[str, str], args: argparse.Namespace):
        import ctranslate2
        import sentencepiece

        self.sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
        with zipfile.ZipFile(path) as archive:
            metadata_names = [name for name in archive.namelist() if name.endswith("/metadata.json")]
            if len(metadata_names) != 1:
                raise ValueError(f"Invalid Argos package metadata: {path}")
            prefix = metadata_names[0].rsplit("/", 1)[0] + "/"
            self.metadata = json.loads(archive.read(metadata_names[0]))
            pair = (self.metadata.get("from_code"), self.metadata.get("to_code"))
            if pair != expected_pair:
                raise ValueError(f"Expected model {expected_pair}; found {pair} in {path}")
            model_prefix = prefix + "model/"
            files = {
                name[len(model_prefix):]: archive.read(name)
                for name in archive.namelist()
                if name.startswith(model_prefix) and not name.endswith("/")
            }
            self.tokenizer = sentencepiece.SentencePieceProcessor(
                model_proto=archive.read(prefix + "sentencepiece.model")
            )
        self.translator = ctranslate2.Translator(
            self.sha256,
            files=files,
            device="cpu",
            compute_type="int8",
            intra_threads=args.threads,
            inter_threads=1,
        )
        self.beam_size = args.beam_size
        self.batch_size = args.batch_size
        self.max_source_tokens = args.max_source_tokens
        self.max_target_tokens = args.max_target_tokens

    def translate(self, texts: list[str]) -> list[dict[str, Any]]:
        tokens = [self.tokenizer.encode(text, out_type=str) for text in texts]
        for text, items in zip(texts, tokens):
            if len(items) > self.max_source_tokens:
                raise ValueError(f"Source exceeds {self.max_source_tokens} tokens (hash {digest(text)})")
        translated = self.translator.translate_batch(
            tokens,
            beam_size=self.beam_size,
            max_batch_size=self.batch_size,
            max_input_length=0,  # Never silently truncate source evidence.
            max_decoding_length=self.max_target_tokens,
            return_scores=True,
        )
        return [
            {
                "text": self.tokenizer.decode(result.hypotheses[0]).replace("\u2581", " ").strip(),
                "score": round(result.scores[0], 6),
                "targetTokens": len(result.hypotheses[0]),
            }
            for result in translated
        ]


def quality_flags(source: str, chinese: str, route: str, target_tokens: int, max_tokens: int) -> list[str]:
    flags = []
    if route != "en-zh":
        flags.append("pivot-translation")
    if not HAN.search(chinese):
        flags.append("no-chinese")
    if re.search(r"[A-Za-z]", chinese):
        flags.append("latin-residue")
    if GRAMMAR.search(source):
        flags.append("grammatical-definition")
    if len(source.split()) <= 1:
        flags.append("short-ambiguous-source")
    if target_tokens >= max_tokens:
        flags.append("decoding-limit")
    if re.search(r"(?:汝等|众生|阿弥陀|菩萨)", chinese) and not re.search(
        r"(?:Buddha|Buddhis|bodhisattva|sentient|thou|thee)", source, re.I
    ):
        flags.append("suspected-hallucination")
    if re.search(r"(.{2,8})\1{3,}", chinese):
        flags.append("repetition")
    phrases = [part.strip() for part in re.split(r"[，,、;；\s]+", chinese) if part.strip()]
    if phrases and max(Counter(phrases).values()) >= 3 and "repetition" not in flags:
        flags.append("repetition")
    if re.search(r"[你我您汝]", chinese) and not re.search(
        r"\b(?:I|me|my|mine|we|us|our|ours|you|your|yours|oneself)\b", source, re.I
    ):
        flags.append("unsupported-personal-reference")
    if len(chinese) > max(100, len(source) * 3):
        flags.append("length-anomaly")
    return flags


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--en-zh-model", required=True, type=Path)
    parser.add_argument("--ca-en-model", type=Path)
    parser.add_argument("--es-en-model", type=Path)
    parser.add_argument("--runtime-dir", type=Path, default=ROOT / "work/translation-runtime")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--beam-size", type=int, default=2)
    parser.add_argument("--max-source-tokens", type=int, default=512)
    parser.add_argument("--max-target-tokens", type=int, default=256)
    parser.add_argument("--limit", type=int, help="Maximum new rows to translate during this run")
    parser.add_argument("--max-definitions-per-lemma", type=int, default=3, help="First N evidence rows per lemma; 0 selects all")
    parser.add_argument("--report", type=Path, help="Write summary JSON here (default: OUTPUT.report.json)")
    parser.add_argument("--issues", type=Path, help="Flagged rows (default: OUTPUT.issues.jsonl)")
    parser.add_argument("--languages", default="en,ca", help="Comma-separated languages to process")
    args = parser.parse_args()
    if min(args.batch_size, args.threads, args.beam_size, args.max_source_tokens, args.max_target_tokens) <= 0:
        parser.error("Batch, thread, beam and token limits must be positive")
    if args.limit is not None and args.limit < 0:
        parser.error("--limit cannot be negative")
    if args.max_definitions_per_lemma < 0:
        parser.error("--max-definitions-per-lemma cannot be negative")
    if args.runtime_dir.is_dir():
        sys.path.insert(0, str(args.runtime_dir))
    try:
        import ctranslate2
        import sentencepiece
    except ImportError as error:
        parser.error(f"Missing offline runtime: {error}; see --help for installation")

    rows = read_jsonl(args.input)
    seen_input = set()
    for number, row in enumerate(rows, 1):
        validate_row(row, number)
        if row_key(row) in seen_input:
            raise ValueError(f"Input row {number}: duplicate evidence identity")
        seen_input.add(row_key(row))
    issues_path = args.issues or args.output.with_suffix(args.output.suffix + ".issues.jsonl")
    if issues_path.resolve() == args.output.resolve():
        parser.error("Candidate output and issues must be separate files")
    done = read_jsonl(args.output) if args.output.exists() else []
    done += read_jsonl(issues_path) if issues_path.exists() else []
    complete = {row_key(row) for row in done}
    languages = set(args.languages.split(","))
    if languages - {"en", "ca", "es"}:
        parser.error("--languages accepts en,ca,es")
    selected = []
    per_lemma: Counter[str] = Counter()
    for row in rows:
        if row["sourceLanguage"] not in languages:
            continue
        lemma = row["normalizedLemma"]
        if args.max_definitions_per_lemma and per_lemma[lemma] >= args.max_definitions_per_lemma:
            continue
        selected.append(row)
        per_lemma[lemma] += 1
    pending = [row for row in selected if row_key(row) not in complete]
    remaining = len(pending)
    if args.limit is not None:
        pending = pending[:args.limit]
    if not pending:
        print(json.dumps({"newRows": 0, "existingRows": len(done), "message": "No pending selected evidence"}))
        return
    required_languages = {row["sourceLanguage"] for row in pending}
    for language, path in (("ca", args.ca_en_model), ("es", args.es_en_model)):
        if language in required_languages and path is None:
            parser.error(f"Selected {language} evidence requires --{language}-en-model")

    started = time.monotonic()
    en_zh = OfflineModel(args.en_zh_model, ("en", "zh"), args)
    pivots = {}
    for language, path in (("ca", args.ca_en_model), ("es", args.es_en_model)):
        if language in required_languages:
            pivots[language] = OfflineModel(path, (language, "en"), args)
    model_hashes = {"en-zh": en_zh.sha256, **{f"{lang}-en": model.sha256 for lang, model in pivots.items()}}
    # Reuse only exact source text from this same model configuration.
    cache = {}
    for row in done:
        if row.get("modelHashes") == model_hashes and row.get("beamSize") == args.beam_size:
            cache[(row["sourceLanguage"], row["sourceText"])] = row
    args.output.parent.mkdir(parents=True, exist_ok=True)
    issues_path.parent.mkdir(parents=True, exist_ok=True)
    translated_count = 0
    needs_review_count = 0
    flag_counts: Counter[str] = Counter()
    with args.output.open("a", encoding="utf-8", buffering=1) as stream, issues_path.open("a", encoding="utf-8", buffering=1) as issues_stream:
        for offset in range(0, len(pending), args.batch_size):
            chunk = pending[offset:offset + args.batch_size]
            for language in sorted({row["sourceLanguage"] for row in chunk}):
                group = [row for row in chunk if row["sourceLanguage"] == language]
                unique_texts = list(dict.fromkeys(row["sourceText"] for row in group if (language, row["sourceText"]) not in cache))
                route = "en-zh" if language == "en" else f"{language}-en-zh"
                source_model = en_zh if language == "en" else pivots[language]
                for source in unique_texts:
                    if len(source_model.tokenizer.encode(source)) > args.max_source_tokens:
                        cache[(language, source)] = {
                            "translationZh": "", "translationRoute": route,
                            "translationScore": None, "qualityFlags": ["source-too-long"],
                        }
                unique_texts = [source for source in unique_texts if (language, source) not in cache]
                intermediate = [item["text"] for item in pivots[language].translate(unique_texts)] if language != "en" else unique_texts
                translated = en_zh.translate(intermediate) if unique_texts else []
                for source, pivot, result in zip(unique_texts, intermediate, translated):
                    cache[(language, source)] = {
                        "translationZh": result["text"],
                        "translationRoute": route,
                        "translationScore": result["score"],
                        "qualityFlags": quality_flags(source, result["text"], route, result["targetTokens"], args.max_target_tokens),
                        **({"intermediateEn": pivot} if language != "en" else {}),
                    }
                for row in group:
                    candidate = cache[(language, row["sourceText"])]
                    result = {
                        **row,
                        **{key: candidate[key] for key in ("translationZh", "translationRoute", "translationScore", "qualityFlags")},
                        **({"intermediateEn": candidate["intermediateEn"]} if "intermediateEn" in candidate else {}),
                        "reviewStatus": "needs-review" if any(flag != "short-ambiguous-source" for flag in candidate["qualityFlags"]) else "machine-translated",
                        "engine": f"CTranslate2 {ctranslate2.__version__}; SentencePiece {sentencepiece.__version__}",
                        "modelHashes": model_hashes,
                        "beamSize": args.beam_size,
                    }
                    target_stream = issues_stream if result["reviewStatus"] == "needs-review" else stream
                    target_stream.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
                    translated_count += 1
                    needs_review_count += result["reviewStatus"] == "needs-review"
                    flag_counts.update(result["qualityFlags"])
            if offset == 0 or translated_count % 1024 < args.batch_size or offset + args.batch_size >= len(pending):
                elapsed = time.monotonic() - started
                print(json.dumps({"newRows": translated_count, "needsReview": needs_review_count, "pendingThisRun": len(pending), "seconds": round(elapsed, 2), "rowsPerSecond": round(translated_count / elapsed, 2), "qualityFlags": dict(flag_counts)}), flush=True)
    report = {
        "inputRows": len(rows), "selectedRows": len(selected), "existingRows": len(done),
        "newRows": translated_count, "needsReview": needs_review_count,
        "machineTranslatedCandidates": translated_count - needs_review_count,
        "remainingSelectedRows": remaining - translated_count,
        "seconds": round(time.monotonic() - started, 2),
        "qualityFlags": dict(flag_counts), "modelHashes": model_hashes,
        "note": "Heuristic flags do not establish translation correctness; every output is unreviewed.",
    }
    report_path = args.report or args.output.with_suffix(args.output.suffix + ".report.json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = report_path.with_suffix(report_path.suffix + ".tmp")
    temporary_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary_path.replace(report_path)
    print(json.dumps(report), flush=True)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        sys.exit(str(error))
