import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const validator = join(root, "scripts/dictionary/validate_translation.py");
const inputPath = join(root, "data/translations/batches/zh-pilot-0001.input.json");
const outputPath = join(root, "data/translations/batches/zh-pilot-0001.original.json");

function validateVariant(change) {
  const directory = mkdtempSync(join(tmpdir(), "catala-translation-validation-"));
  try {
    const input = JSON.parse(readFileSync(inputPath, "utf8"));
    const output = JSON.parse(readFileSync(outputPath, "utf8"));
    change(input, output);
    const variantInput = join(directory, "input.json");
    const variantOutput = join(directory, "output.json");
    writeFileSync(variantInput, JSON.stringify(input));
    writeFileSync(variantOutput, JSON.stringify(output));
    const result = spawnSync("python3", [validator, variantInput, variantOutput], {
      encoding: "utf8",
      cwd: root,
      timeout: 10_000,
    });
    assert.ifError(result.error);
    return result;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function rejected(change, message) {
  const result = validateVariant(change);
  assert.equal(result.status, 1, `Expected validation failure:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, message);
}

test("translation validator accepts the complete original draft's structure", () => {
  const result = validateVariant(() => {});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Valid draft zh-pilot-0001: 25 records/u);
  assert.match(result.stdout, /translation quality still requires review/u);
});

test("reviewed imports bind evidence to source packs even when altered hashes are valid", () => {
  const script = `
import copy, hashlib, json, pathlib, sys, tempfile
sys.path.insert(0, sys.argv[1])
import build_search as b
root = pathlib.Path(sys.argv[2])
original = json.loads((root / 'data/translations/batches/zh-reviewed-0005.input.json').read_text())
output = json.loads((root / 'data/translations/batches/zh-reviewed-0005.reviewed.json').read_text())
original['records'] = [r for r in original['records'] if r['normalizedLemma'] == 'roca']
output['records'] = [r for r in output['records'] if r['normalizedLemma'] == 'roca']
original['recordCount'] = output['recordCount'] = 1
evidence = original['records'][0]['evidence'][0]
assert len(original['records'][0]['evidence']) == 1
records = {'roca': [(evidence['layer'], {'n': 'roca', 'l': 'roca', 'p': evidence['recordPartOfSpeech'], 's': evidence['recordSourceIds'], 'd': {evidence['declaredLanguage']: [evidence['text']]}})]}
entries = {'roca': {'n': 'roca', 'l': 'roca'}}
with tempfile.TemporaryDirectory() as temporary:
    directory = pathlib.Path(temporary)
    def write():
        (directory / 'sample.input.json').write_text(json.dumps(original))
        (directory / 'sample.reviewed.json').write_text(json.dumps(output))
    write()
    assert 'roca' in b.reviewed_overlays(directory, entries, original['dictionaryVersion'], records)[0]
    evidence['text'] = 'A source definition that was never present in this dictionary.'
    record = original['records'][0]
    record['inputHash'] = b.digest(b.canonical({k: v for k, v in record.items() if k != 'inputHash'}))
    output['records'][0]['inputHash'] = record['inputHash']
    assert not b.validate_batch(original, output)
    write()
    try:
        b.reviewed_overlays(directory, entries, original['dictionaryVersion'], records)
    except ValueError as error:
        assert 'evidence differs from committed source packs' in str(error)
    else:
        raise AssertionError('Altered evidence was accepted')
`;
  const result = spawnSync("python3", ["-c", script, join(root, "scripts/dictionary"), root], {
    encoding: "utf8", timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test("translation validator rejects altered identifiers and record order", () => {
  rejected((input, output) => {
    output.records[0].id = input.records[1].id;
  }, /\.id: does not match input|duplicate output id/u);
  rejected((input, output) => {
    [output.records[0], output.records[1]] = [output.records[1], output.records[0]];
  }, /same position/u);
});

test("translation validator recomputes canonical input hashes", () => {
  rejected((input, output) => {
    input.records[0].evidence[0].text += " forged source";
    output.records[0].inputHash = input.records[0].inputHash;
  }, /inputHash: does not match canonical input SHA-256/u);
  rejected((input, output) => {
    input.records[0].inputHash = "0".repeat(64);
    output.records[0].inputHash = input.records[0].inputHash;
  }, /inputHash: does not match canonical input SHA-256/u);
  rejected((input, output) => {
    output.records[0].inputHash = "0".repeat(64);
  }, /output\.records\[0\]\.inputHash: does not match input/u);
});

test("translation validator rejects evidence borrowed from another record", () => {
  rejected((input, output) => {
    const target = input.records.findIndex((record) => record.lemma === "una");
    assert.deepEqual(input.records[target].evidence.map((item) => item.id), ["e001"]);
    assert.ok(input.records.some((record) => record.evidence.some((item) => item.id === "e002")));
    output.records[target].senses[0].sourceRefs = ["e002"];
  }, /sourceRefs: 'e002' is not evidence in this input record/u);
});

test("translation validator rejects duplicate and combined aliases", () => {
  rejected((input, output) => {
    output.records[0].senses[0].aliasesZh = ["缩合形式", "缩合形式"];
  }, /aliasesZh\[1\]: duplicate value/u);
  rejected((input, output) => {
    output.records[0].senses[0].aliasesZh = ["缩合；缩写"];
  }, /semicolon-separated aliases/u);
});

test("translation validator rejects contradictory statuses", () => {
  rejected((input, output) => {
    output.records[0].status = "needs_review";
  }, /needs_review and skipped records require an issue/u);
  rejected((input, output) => {
    output.records[0].status = "skipped";
    output.records[0].issues = [{ code: "form_only", sourceRefs: ["e001"], noteZh: "仅词形说明" }];
  }, /skipped records must have no senses/u);
  rejected((input, output) => {
    output.records[0].issues = [{ code: "form_only", sourceRefs: ["e001"], noteZh: "仅词形说明" }];
  }, /translated records must have no issues/u);
});

test("translation validator rejects schema drift, empty evidence, and placeholders", () => {
  rejected((input, output) => {
    output.records[0].senses[0].unexpected = true;
  }, /unexpected fields: unexpected/u);
  rejected((input, output) => {
    output.records[0].senses[0].sourceRefs = [];
  }, /sourceRefs: must not be empty/u);
  rejected((input, output) => {
    output.records[0].senses[0].translationZh = "待补充";
  }, /placeholder text is not allowed/u);
  rejected((input, output) => {
    output.records[0].senses[0].translationZh = "contraction";
  }, /must contain Chinese characters/u);
});
