import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import test from "node:test";
import { grammaticalChinese } from "../scripts/dictionary/bulk_chinese_rules.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("grammatical Chinese preserves Catalan references and distinguishes alphabet names from pronouns", () => {
  const job = { kind: "definition", sourceLanguage: "en", sourcePartOfSpeech: ["noun"] };
  assert.equal(grammaticalChinese({ ...job, sourceText: "alternative form of fossa" }), "「fossa」的另一种形式或拼写");
  assert.equal(grammaticalChinese({ ...job, sourceText: "alternative form of van" }), "「van」的另一种形式或拼写");
  assert.equal(grammaticalChinese({ ...job, sourceText: "contraction of de + es" }), "「de + es」的缩合形式");
  assert.equal(grammaticalChinese({ ...job, kind: "translation_hint", sourceLanguage: "es", sourceText: "n" }), "拉丁字母 N（n）");
  assert.equal(grammaticalChinese({ ...job, kind: "translation_hint", sourceLanguage: "es", sourcePartOfSpeech: ["pronoun"], sourceText: "y" }), undefined);
  assert.equal(grammaticalChinese({ ...job, sourceText: "a van used to transport goods" }), undefined);
  assert.equal(grammaticalChinese({ ...job, kind: "headword", sourceLanguage: "ca", sourcePartOfSpeech: ["pronoun"], sourceText: "la hi" }), "加泰语弱读代词组合「la hi」");
  assert.equal(grammaticalChinese({ ...job, kind: "headword", sourceLanguage: "ca", sourcePartOfSpeech: ["pronoun"], sourceText: "m'hi" }), "加泰语弱读代词组合「m'hi」");
  assert.equal(grammaticalChinese({ ...job, kind: "headword", sourceLanguage: "ca", sourcePartOfSpeech: ["pronoun"], sourceText: "algú altre" }), undefined);
});

test("published assets cover Chinese except explicitly source-bound gaps and retain quality distinctions", () => {
  const base = JSON.parse(readFileSync(join(root, "public/dictionary/manifest.json")));
  const search = JSON.parse(readFileSync(join(root, "public/dictionary/search/manifest.json")));
  const read = (descriptor) => {
    const compressed = readFileSync(join(root, "public", descriptor.path));
    assert.equal(createHash("sha256").update(compressed).digest("hex"), descriptor.sha256);
    const rows = JSON.parse(gunzipSync(compressed));
    assert.equal(rows.length, descriptor.entries);
    return rows;
  };
  const han = /\p{Script=Han}/u;
  const chinese = (row) => [...(row.zh ?? []), ...(row.d?.zh ?? [])].some((text) => han.test(text));
  const original = new Map();
  for (const descriptor of [...base.lex, ...base.enrichment.freedict, ...base.enrichment.wiktionary, ...base.enrichment.curated]) {
    for (const row of read(descriptor)) original.set(row.n, chinese(row) || original.get(row.n) || false);
  }
  const all = new Map(original);
  const core = read(search.core.entries);
  for (const row of core) all.set(row.n, chinese(row) || all.get(row.n) || false);
  let machine = 0, headword = 0, wordnet = 0;
  for (const descriptor of search.chinese) {
    for (const row of read(descriptor)) {
      assert.ok(!original.get(row.n), `Chinese overlay replaces original Chinese: ${row.n}`);
      assert.ok(chinese(row), `Chinese overlay has no Chinese: ${row.n}`);
      assert.ok(!row.zh.some((text) => /待翻译|待补充|\b(?:TODO|TBD)\b|ZXQSEG|QXZ|Wikipedia tiene un artículo/iu.test(text)));
      if (row.zhMachine) {
        machine++;
        assert.ok(row.s.includes("bulk-zh-ms-20261012"));
        assert.ok(row.pv.some((p) => p.sourceId === "bulk-zh-ms-20261012" && /^[0-9a-f]{64}$/.test(p.sourceEntryId)));
      }
      if (row.zhHeadword) { headword++; assert.ok(row.zhMachine); }
      if (row.zhReference) { wordnet++; assert.ok(!row.zhMachine); }
      all.set(row.n, true);
    }
  }
  assert.equal(all.size, 97_675);
  const gaps = JSON.parse(readFileSync(join(root, "data/translations/bulk/source-gaps.json")));
  const uncovered = [...all].filter(([, covered]) => !covered).map(([lemma]) => lemma).sort();
  assert.deepEqual(uncovered, gaps.map((row) => row.normalizedLemma).sort());
  assert.deepEqual(uncovered, ["anapat", "carri", "e)", "e.", "grl", "ivaei", "vé."].sort());
  assert.ok(gaps.every((row) => row.status === "source-insufficient" && /^[0-9a-f]{64}$/.test(row.jobId)));
  assert.ok(core.every(chinese));
  assert.equal(search.coverage.chineseLemmas, all.size - uncovered.length);
  assert.equal(search.coverage.missingChineseLemmas, uncovered.length);
  assert.equal(search.coverage.bulkChinese.sourceInsufficientLemmas, uncovered.length);
  assert.equal(machine, search.coverage.machineChineseLemmas);
  assert.equal(headword, search.coverage.bulkChinese.headwordOnlyLemmas);
  assert.equal(wordnet, 10_785);
});

test("literal grammatical references retain source text and opt out of meaning search", () => {
  const directory = join(root, "data/translations/bulk");
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json")));
  let count = 0, clitic = false;
  for (const descriptor of manifest.files) {
    const lines = gunzipSync(readFileSync(join(directory, descriptor.file))).toString().trim().split("\n");
    for (const line of lines) {
      const row = JSON.parse(line);
      if (row.engine !== "literal grammatical template") continue;
      count += 1;
      assert.deepEqual(row.aliasesZh, []);
      assert.equal(row.reviewStatus, "machine-translated");
      if (row.normalizedLemma === "la hi") {
        assert.equal(row.translationZh, "加泰语弱读代词组合「la hi」");
        clitic = true;
      }
    }
  }
  assert.equal(count, manifest.literalGrammarSenses);
  assert.ok(clitic);
});

test("bulk Chinese binds definition, verified hint and headword evidence to actual source packs", () => {
  const script = `
import gzip, hashlib, json, pathlib, sys, tempfile
sys.path.insert(0, sys.argv[1])
import build_search as b
import bulk_chinese as c
entries = {'mot': {'l': 'mot', 'n': 'mot', 'p': ['noun']}}
records = {'mot': [('lex', {'l': 'mot', 'n': 'mot', 'p': ['noun'], 'es': ['palabra'], 's': ['apertium-test']}), ('wiktionary', {'l': 'mot', 'n': 'mot', 'p': ['noun'], 'd': {'en': ['word']}, 's': ['wiktionary-test']})]}
evidence = b.source_evidence(records['mot'])
jobs = [c.job_for_evidence('mot', e) for e in evidence] + [c.headword_job(entries['mot'], records['mot'])]
rows = [{**r, 'baseDataVersion': 'test', 'translationZh': '词语', 'reviewStatus': 'machine-translated'} for r in jobs]
with tempfile.TemporaryDirectory() as temporary:
    directory = pathlib.Path(temporary)
    def write(values):
        data = gzip.compress(b''.join(c.canonical(r) + b'\\n' for r in values), mtime=0)
        (directory / 'rows.jsonl.gz').write_bytes(data)
        (directory / 'manifest.json').write_text(json.dumps({'schemaVersion': 1, 'baseDataVersion': 'test', 'reviewStatus': 'machine-translated', 'sourceId': 'bulk-test', 'files': [{'file': 'rows.jsonl.gz', 'bytes': len(data), 'rows': len(values), 'sha256': hashlib.sha256(data).hexdigest()}]}))
    def load(e=entries):
        return c.load_bulk(directory, e, records, 'test', b.source_evidence, b.short_chinese_terms)
    write(rows)
    overlays, aliases, counts, signature = load()
    assert overlays['mot']['zhMachine'] and overlays['mot']['zhHeadword']
    assert len(overlays['mot']['pv']) == 3
    assert counts['sourceSenses'] == 3
    assert '词语' in aliases['mot']
    write([{**rows[0], 'translationZh': '来自 Todolella 的'}])
    assert 'Todolella' in load()[0]['mot']['zh'][0]
    write([{**rows[0], 'translationZh': '中文 TODO'}])
    try:
        load()
    except ValueError as error:
        assert 'Invalid' in str(error)
    else:
        raise AssertionError('An actual placeholder was imported')
    write(rows)
    assert not load({'mot': {**entries['mot'], 'zh': ['已有中文']}})[0]
    altered = {**rows[-1], 'sourceText': 'a nonexistent headword'}
    c.identified(altered)
    write([altered])
    try:
        load()
    except ValueError as error:
        assert 'evidence differs' in str(error)
    else:
        raise AssertionError('Rehashed fabricated headword was imported')
    write([rows[0], rows[0]])
    try:
        load()
    except ValueError as error:
        assert 'Duplicate' in str(error)
    else:
        raise AssertionError('Duplicate source row was imported')
    write([{**rows[0], 'aliasesZh': ['无关的检索词']}])
    try:
        load()
    except ValueError as error:
        assert 'alias differs' in str(error)
    else:
        raise AssertionError('Unrelated reverse-search alias was imported')
    write([rows[0]])
    (directory / 'source-holds.json').write_text(json.dumps([{'normalizedLemma': 'mot', 'sourceText': rows[0]['sourceText']}]))
    try:
        load()
    except ValueError as error:
        assert 'Held' in str(error)
    else:
        raise AssertionError('A known ambiguous source hold was ignored')
`;
  const result = spawnSync("python3", ["-c", script, join(root, "scripts/dictionary")], {
    encoding: "utf8", timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
