#!/usr/bin/env python3
"""Validate a translation batch's structure and binding to its source evidence.

This checks import safety, not translation quality or whether a cited definition
actually supports the proposed meaning. Run a separate linguistic review before
promoting a translation draft.
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


INPUT_FIELDS = {
    "schemaVersion", "batchId", "dictionaryVersion", "sourceCommit",
    "recordCount", "selection", "records",
}
INPUT_RECORD_FIELDS = {
    "id", "lemma", "normalizedLemma", "partOfSpeech", "existingChinese",
    "priorityRank", "evidence", "inputHash",
}
EVIDENCE_FIELDS = {
    "id", "kind", "declaredLanguage", "text", "recordSourceIds",
    "recordPartOfSpeech", "layer",
}
OUTPUT_FIELDS = {"schemaVersion", "batchId", "recordCount", "records"}
OUTPUT_RECORD_FIELDS = {
    "id", "lemma", "normalizedLemma", "inputHash", "status", "senses", "issues",
}
SENSE_FIELDS = {"sourceRefs", "partOfSpeech", "translationZh", "aliasesZh"}
ISSUE_FIELDS = {"code", "sourceRefs", "noteZh"}
ISSUE_CODES = {
    "source_language_mismatch", "source_conflict", "damaged_source", "form_only",
    "ambiguous_sense", "insufficient_evidence", "existing_chinese",
}
STATUSES = {"translated", "needs_review", "skipped"}
HAN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U000323af]")
PLACEHOLDER = re.compile(
    r"待补充|待翻译|未翻译|省略|暂无(?:释义|中文|翻译)|请(?:在此)?(?:填写|补充)"
    r"|TODO|TBD|placeholder|\.{3}|…{1,2}", re.IGNORECASE,
)


def _fields(value, required, path, errors, optional=frozenset()):
    if not isinstance(value, dict):
        errors.append(f"{path}: must be an object")
        return False
    missing = required - value.keys()
    extra = value.keys() - required - optional
    if missing:
        errors.append(f"{path}: missing fields: {', '.join(sorted(missing))}")
    if extra:
        errors.append(f"{path}: unexpected fields: {', '.join(sorted(extra))}")
    return True


def _text(value, path, errors):
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{path}: must be a nonempty string")
        return False
    return True


def _strings(value, path, errors, *, nonempty=False, unique=False):
    if not isinstance(value, list):
        errors.append(f"{path}: must be an array")
        return []
    if nonempty and not value:
        errors.append(f"{path}: must not be empty")
    seen = set()
    for index, item in enumerate(value):
        if _text(item, f"{path}[{index}]", errors):
            if unique and item in seen:
                errors.append(f"{path}[{index}]: duplicate value {item!r}")
            seen.add(item)
    return value


def _count(value, path, errors):
    if type(value) is not int or value < 0:
        errors.append(f"{path}: must be a nonnegative integer")


def _refs(value, allowed, path, errors, *, nonempty):
    for ref in _strings(value, path, errors, nonempty=nonempty, unique=True):
        if isinstance(ref, str) and ref not in allowed:
            errors.append(f"{path}: {ref!r} is not evidence in this input record")


def validate_batch(input_batch, output_batch):
    """Return all detected structural/binding errors, or [] for a valid draft."""
    errors = []
    if not _fields(input_batch, INPUT_FIELDS, "input", errors):
        return errors
    if not _fields(output_batch, OUTPUT_FIELDS, "output", errors):
        return errors

    for name, batch in (("input", input_batch), ("output", output_batch)):
        if type(batch.get("schemaVersion")) is not int or batch["schemaVersion"] != 1:
            errors.append(f"{name}.schemaVersion: must be 1")
        _text(batch.get("batchId"), f"{name}.batchId", errors)
        _count(batch.get("recordCount"), f"{name}.recordCount", errors)
        if not isinstance(batch.get("records"), list):
            errors.append(f"{name}.records: must be an array")
        elif batch.get("recordCount") != len(batch["records"]):
            errors.append(f"{name}.recordCount: does not match records length")
    for field in ("dictionaryVersion", "sourceCommit", "selection"):
        _text(input_batch.get(field), f"input.{field}", errors)
    if output_batch.get("batchId") != input_batch.get("batchId"):
        errors.append("output.batchId: does not match input")
    if output_batch.get("recordCount") != input_batch.get("recordCount"):
        errors.append("output.recordCount: does not match input")

    input_records = input_batch.get("records")
    output_records = output_batch.get("records")
    if not isinstance(input_records, list) or not isinstance(output_records, list):
        return errors
    if len(output_records) != len(input_records):
        errors.append("output.records: length does not match input; records are missing or added")

    input_ids = set()
    evidence_ids_by_index = []
    for index, record in enumerate(input_records):
        path = f"input.records[{index}]"
        evidence_ids = set()
        evidence_ids_by_index.append(evidence_ids)
        if not _fields(record, INPUT_RECORD_FIELDS, path, errors):
            continue
        for field in ("id", "lemma", "normalizedLemma", "inputHash"):
            _text(record.get(field), f"{path}.{field}", errors)
        record_id = record.get("id")
        if isinstance(record_id, str):
            if record_id in input_ids:
                errors.append(f"{path}.id: duplicate input id {record_id!r}")
            input_ids.add(record_id)
        _strings(record.get("partOfSpeech"), f"{path}.partOfSpeech", errors, unique=True)
        _strings(record.get("existingChinese"), f"{path}.existingChinese", errors)
        _count(record.get("priorityRank"), f"{path}.priorityRank", errors)
        try:
            canonical = json.dumps(
                {key: value for key, value in record.items() if key != "inputHash"},
                ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
            )
            expected_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
            if record.get("inputHash") != expected_hash:
                errors.append(f"{path}.inputHash: does not match canonical input SHA-256")
        except (TypeError, ValueError, UnicodeError) as error:
            errors.append(f"{path}.inputHash: cannot canonicalize input: {error}")
        evidence = record.get("evidence")
        if not isinstance(evidence, list):
            errors.append(f"{path}.evidence: must be an array")
            continue
        for evidence_index, item in enumerate(evidence):
            evidence_path = f"{path}.evidence[{evidence_index}]"
            if not _fields(item, EVIDENCE_FIELDS, evidence_path, errors, {"languageVerified"}):
                continue
            for field in ("id", "declaredLanguage", "text", "layer"):
                _text(item.get(field), f"{evidence_path}.{field}", errors)
            evidence_id = item.get("id")
            if isinstance(evidence_id, str):
                if evidence_id in evidence_ids:
                    errors.append(f"{evidence_path}.id: duplicate evidence id {evidence_id!r}")
                evidence_ids.add(evidence_id)
            if item.get("kind") not in ("definition", "translation_hint"):
                errors.append(f"{evidence_path}.kind: must be definition or translation_hint")
            if "languageVerified" in item and type(item["languageVerified"]) is not bool:
                errors.append(f"{evidence_path}.languageVerified: must be a boolean")
            _strings(item.get("recordSourceIds"), f"{evidence_path}.recordSourceIds", errors, nonempty=True, unique=True)
            _strings(item.get("recordPartOfSpeech"), f"{evidence_path}.recordPartOfSpeech", errors, unique=True)

    output_ids = set()
    for index, record in enumerate(output_records):
        path = f"output.records[{index}]"
        if not _fields(record, OUTPUT_RECORD_FIELDS, path, errors):
            continue
        expected = input_records[index] if index < len(input_records) else None
        if not isinstance(expected, dict):
            expected = {}
        for field in ("id", "lemma", "normalizedLemma", "inputHash"):
            _text(record.get(field), f"{path}.{field}", errors)
            if record.get(field) != expected.get(field):
                errors.append(f"{path}.{field}: does not match input record at the same position")
        record_id = record.get("id")
        if isinstance(record_id, str):
            if record_id in output_ids:
                errors.append(f"{path}.id: duplicate output id {record_id!r}")
            output_ids.add(record_id)
        status = record.get("status")
        if not isinstance(status, str) or status not in STATUSES:
            errors.append(f"{path}.status: must be translated, needs_review, or skipped")
        senses = record.get("senses")
        issues = record.get("issues")
        if not isinstance(senses, list):
            errors.append(f"{path}.senses: must be an array")
            senses = []
        if not isinstance(issues, list):
            errors.append(f"{path}.issues: must be an array")
            issues = []
        if status == "skipped" and senses:
            errors.append(f"{path}.senses: skipped records must have no senses")
        if status in ("translated", "needs_review") and not senses:
            errors.append(f"{path}.senses: translated and needs_review records require senses")
        if status == "translated" and issues:
            errors.append(f"{path}.issues: translated records must have no issues")
        if status in ("needs_review", "skipped") and not issues:
            errors.append(f"{path}.issues: needs_review and skipped records require an issue")
        if expected.get("existingChinese") and status != "skipped":
            errors.append(f"{path}.status: records with existing Chinese must be skipped")

        allowed_refs = evidence_ids_by_index[index] if index < len(evidence_ids_by_index) else set()
        allowed_pos = expected.get("partOfSpeech", [])
        if not isinstance(allowed_pos, list):
            allowed_pos = []
        for sense_index, sense in enumerate(senses):
            sense_path = f"{path}.senses[{sense_index}]"
            if not _fields(sense, SENSE_FIELDS, sense_path, errors):
                continue
            _refs(sense.get("sourceRefs"), allowed_refs, f"{sense_path}.sourceRefs", errors, nonempty=True)
            pos = sense.get("partOfSpeech")
            if pos is not None and (not isinstance(pos, str) or pos not in allowed_pos):
                errors.append(f"{sense_path}.partOfSpeech: must be null or a part of speech in this input record")
            translation = sense.get("translationZh")
            if _text(translation, f"{sense_path}.translationZh", errors):
                if not HAN.search(translation):
                    errors.append(f"{sense_path}.translationZh: must contain Chinese characters")
                if PLACEHOLDER.fullmatch(translation.strip()):
                    errors.append(f"{sense_path}.translationZh: placeholder text is not allowed")
            aliases = _strings(sense.get("aliasesZh"), f"{sense_path}.aliasesZh", errors, unique=True)
            if len(aliases) > 3:
                errors.append(f"{sense_path}.aliasesZh: must have at most 3 aliases")
            trimmed_aliases = set()
            for alias_index, alias in enumerate(aliases):
                if not isinstance(alias, str):
                    continue
                alias_path = f"{sense_path}.aliasesZh[{alias_index}]"
                if ";" in alias or "；" in alias:
                    errors.append(f"{alias_path}: semicolon-separated aliases are not allowed")
                trimmed = alias.strip()
                if trimmed != alias:
                    errors.append(f"{alias_path}: surrounding whitespace is not allowed")
                if trimmed in trimmed_aliases and alias not in aliases[:alias_index]:
                    errors.append(f"{alias_path}: duplicate alias after trimming")
                trimmed_aliases.add(trimmed)
        for issue_index, issue in enumerate(issues):
            issue_path = f"{path}.issues[{issue_index}]"
            if not _fields(issue, ISSUE_FIELDS, issue_path, errors):
                continue
            code = issue.get("code")
            if not isinstance(code, str) or code not in ISSUE_CODES:
                errors.append(f"{issue_path}.code: unsupported issue code")
            # Empty references explicitly represent a record-wide issue in the
            # handoff schema; individual references must still be record-local.
            _refs(issue.get("sourceRefs"), allowed_refs, f"{issue_path}.sourceRefs", errors, nonempty=False)
            _text(issue.get("noteZh"), f"{issue_path}.noteZh", errors)
    return errors


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON object key: {key!r}")
        result[key] = value
    return result


def _invalid_constant(value):
    raise ValueError(f"invalid JSON numeric constant: {value}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Original batch input JSON")
    parser.add_argument("output", type=Path, help="Translation draft JSON")
    args = parser.parse_args(argv)
    batches = []
    for name, path in (("input", args.input), ("output", args.output)):
        try:
            with path.open(encoding="utf-8") as handle:
                batches.append(json.load(handle, object_pairs_hook=_unique_object, parse_constant=_invalid_constant))
        except (OSError, UnicodeError, ValueError) as error:
            print(f"{name}: cannot read valid UTF-8 JSON from {path}: {error}", file=sys.stderr)
            return 1
    errors = validate_batch(*batches)
    if errors:
        print(f"Translation batch validation failed ({len(errors)} errors):", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    batch = batches[1]
    counts = {status: sum(record["status"] == status for record in batch["records"]) for status in sorted(STATUSES)}
    senses = sum(len(record["senses"]) for record in batch["records"])
    print(f"Valid draft {batch['batchId']}: {batch['recordCount']} records, {senses} senses; "
          + ", ".join(f"{status}={count}" for status, count in counts.items()))
    print("Structure and source binding passed; translation quality still requires review.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
