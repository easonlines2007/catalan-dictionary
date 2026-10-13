import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("Wordnet requires exact source sense, POS and trusted accent-preserving Spanish corroboration", () => {
  const script = `
import copy, pathlib, sys, tempfile, shutil
sys.path.insert(0, sys.argv[1])
import build_search as b
import wordnet as w
root = pathlib.Path(sys.argv[2])
synset = '00000001-n'
tables = {'cat': {synset: {'mot'}}, 'spa': {synset: {'término'}}, 'cmn': {synset: {'词语', '字词'}}}
exclusions = {'senses': [], 'terms': []}
entries = {'mot': {'l': 'mot', 'n': 'mot', 'p': ['noun']}}
records = {'mot': [('lex', {'es': ['término'], 's': ['apertium-test']})]}
def align(e=entries, r=records, t=tables, x=exclusions):
    return w.align(e, r, t, x, b.normalize, b.TRUSTED_SPANISH_LAYERS)
overlays, aliases, evidence, counts = align()
assert overlays['mot']['zhReference']
assert overlays['mot']['pv'][0]['sourceEntryId'] == 'pwn-3.0:' + synset
assert set(aliases['mot']) == {'词语', '字词'}
assert evidence[0]['senses'][0]['corroboratingSourceIds'] == ['apertium-test']
assert counts['alignedLemmas'] == 1
assert not align(e={'mot': {**entries['mot'], 'zh': ['原中文']}})[0]
assert not align(e={'mot': {**entries['mot'], 'p': ['verb']}})[0]
assert not align(r={'mot': [('wiktionary', records['mot'][0][1])]})[0]
assert not align(r={'mot': [('lex', {'es': ['termino'], 's': ['apertium-test']})]})[0]
wrong_sense = copy.deepcopy(tables)
wrong_sense['cmn'] = {'00000002-n': {'词语'}}
assert not align(t=wrong_sense)[0]
assert not align(x={'senses': [{'lemma': 'mot', 'synset': synset}], 'terms': []})[0]
assert align(x={'senses': [], 'terms': [{'synset': synset, 'term': '词语'}]})[1]['mot'] == ['字词']
assert w.clean_chinese('心脏收缩+的') == '心脏收缩的'
assert w.clean_chinese('待翻译') is None
assert w.clean_chinese('非+正常') is None
directory = root / 'scripts/dictionary/vendor/omw'
actual, holds, signature = w.load_sources(directory)
assert '瀑布' in actual['cmn']['09475292-n']
assert ('plusvàlua', '13312190-n') in {(r['lemma'], r['synset']) for r in holds['senses']}
assert ('ara', '09202285-n') in {(r['lemma'], r['synset']) for r in holds['senses']}
assert signature['revision'] == '406bf83b3c507a3d1f26e88252d5d66893fd36bf'
with tempfile.TemporaryDirectory() as temporary:
    destination = pathlib.Path(temporary)
    shutil.copytree(directory, destination, dirs_exist_ok=True)
    with (destination / 'cmn.tab.gz').open('ab') as handle:
        handle.write(b'tampered')
    try:
        w.load_sources(destination)
    except ValueError as error:
        assert 'checksum mismatch' in str(error)
    else:
        raise AssertionError('Tampered source was accepted')
`;
  const result = spawnSync("python3", ["-c", script, join(root, "scripts/dictionary"), root], {
    encoding: "utf8", timeout: 20_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});
