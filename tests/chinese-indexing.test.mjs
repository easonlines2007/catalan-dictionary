import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("alias priority belongs to the selected Chinese term and keeps alternative senses available", () => {
  const script = `
import sys,json,tempfile,pathlib
sys.path.insert(0,sys.argv[1])
from build_search import search_aliases,preferred_alias_terms,build_indexes
records={'reply':[('wiktionary',{'d':{'en':['to reply']}})],'answer':[('wiktionary',{'d':{'en':['an answer']}})]}
entries={'reply':{'r':1},'answer':{'r':2}}
data={'baseDataVersion':'base','records':[
 {'lemma':'reply','terms':['回答'],'preferred':True,'evidence':[{'layer':'wiktionary','field':'d.en','text':'to reply'}]},
 {'lemma':'answer','terms':['答案','回答'],'preferredTerms':['答案'],'evidence':[{'layer':'wiktionary','field':'d.en','text':'an answer'}]}
]}
with tempfile.TemporaryDirectory() as directory:
 p=pathlib.Path(directory)/'aliases.json'
 p.write_text(json.dumps(data))
 aliases=search_aliases(p,records,'base')
 preferred={(r['lemma'],term) for r in data['records'] for term in preferred_alias_terms(r)}
 indexes,_=build_indexes(records,entries,{},lambda x:x,lambda x:x,aliases,preferred)
 reverse=dict(indexes['zh'])
 assert reverse['回答'][0][0]=='reply'
 assert reverse['答案'][0][0]=='answer'
 assert reverse['答案'][0][3]==1
 assert any(row[0]=='answer' and len(row)==3 for row in reverse['回答'])
 for value in ('答案',None,['不存在'],['答案','答案'],[7]):
  invalid=json.loads(json.dumps(data));invalid['records'][1]['preferredTerms']=value
  p.write_text(json.dumps(invalid))
  try: search_aliases(p,records,'base')
  except ValueError: pass
  else: raise AssertionError('Invalid term priority accepted: '+str(value))
 invalid=json.loads(json.dumps(data));invalid['records'][1]['preferred']=True
 p.write_text(json.dumps(invalid))
 try: search_aliases(p,records,'base')
 except ValueError: pass
 else: raise AssertionError('Conflicting whole-lemma and term preference accepted')
 for value in ('true',1,[],None):
  invalid=json.loads(json.dumps(data));invalid['records'][1]['core']=value
  p.write_text(json.dumps(invalid))
  try: search_aliases(p,records,'base')
  except ValueError: pass
  else: raise AssertionError('Invalid core selection accepted: '+str(value))
`;
  const result = spawnSync("python3", ["-c", script, resolve(root, "scripts/dictionary")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("Chinese reverse indexing preserves short synonyms without promoting contextual examples", () => {
  const script = `
import sys
sys.path.insert(0,sys.argv[1])
from build_search import short_chinese_terms as terms
assert list(terms('牛奶；乳汁、奶')) == ['牛奶','乳汁','奶']
assert list(terms('（名词）学校；學校')) == ['学校','學校']
assert list(terms('苹果（水果、植物的果实）')) == ['苹果（水果、植物的果实）']
assert list(terms('一种基于七种其他语言（英语、西班牙语、葡萄牙语、法语、意大利语、德语和俄语）词汇和语法的人造语言。')) == []
assert list(terms('易于清洁且耐冲击的覆盖材料，主要用于厨房、火车、公交车地板。')) == []
assert list(terms('由红色、黄色组成')) == ['由红色、黄色组成']
assert list(terms('细微差别\\n修饰')) == ['细微差别','修饰']
assert list(terms('你好！')) == ['你好']
assert list(terms('注意：这是长句中的举例、说明。')) == []
assert list(terms('使符合，遵守，符合某法律、原则、规范、习俗。')) == ['使符合，遵守，符合某法律、原则、规范、习俗']
assert list(terms('与球队有关，作为球员、球迷、教练等。')) == ['与球队有关，作为球员、球迷、教练等']
assert list(terms('，作为球员、球迷、教练等。')) == ['作为球员、球迷、教练等']
assert list(terms('肉、鱼或豆类制成的面团球，裹上面粉后煎炸。')) == ['肉、鱼或豆类制成的面团球，裹上面粉后煎炸']
assert list(terms('叫声,如乌鸦、渡鸦。')) == ['叫声,如乌鸦、渡鸦']
assert list(terms('软（细腻，柔滑）、柔软')) == ['软（细腻，柔滑）','柔软']
assert list(terms('颗粒，含盐、糖；糖果、甜食')) == ['颗粒，含盐、糖','糖果','甜食']
assert list(terms('逐渐、快速且令人警觉的增加。')) == ['逐渐、快速且令人警觉的增加']
assert list(terms('狼、狗及类似动物发出的带音调变化的哀鸣。')) == ['狼、狗及类似动物发出的带音调变化的哀鸣']
assert list(terms('谷歌、苹果、脸书、亚马逊和微软五家科技公司的合称')) == ['谷歌、苹果、脸书、亚马逊和微软五家科技公司的合称']
assert list(terms('柔软、温和的')) == ['柔软','温和的']
assert list(terms('柔软、温和的（形容状态）')) == ['柔软','温和的（形容状态）']
assert list(terms('精通型、magistral（大师或精通者的特征）')) == ['精通型','magistral（大师或精通者的特征）']
assert list(terms('柔软、温和的〔说明〕')) == ['柔软','温和的〔说明〕']
assert list(terms('温和、柔和的（方式（或其他语境）的说明）')) == ['温和','柔和的（方式（或其他语境）的说明）']
assert list(terms('声音；狼、狗及类似动物发出的哀鸣')) == ['声音','狼、狗及类似动物发出的哀鸣']
`;
  const result = spawnSync("python3", ["-c", script, resolve(root, "scripts/dictionary")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("Chinese runtime tables reproduce pinned sources and reject tampering", () => {
  const script = `
import sys,json,gzip,tempfile,pathlib,shutil,hashlib
root=pathlib.Path(sys.argv[1]);sys.path.insert(0,str(root/'scripts/dictionary'))
from build_chinese_search import build,toneless
original=json.loads((root/'lib/chinese-search-data.json').read_text())
with tempfile.TemporaryDirectory() as temporary:
    target=pathlib.Path(temporary)
    shutil.copytree(root/'scripts/dictionary/vendor',target/'scripts/dictionary/vendor')
    (target/'lib').mkdir();(target/'public/dictionary/search').mkdir(parents=True)
    result=build(target);assert result==original
    phrases=json.loads(gzip.decompress((target/'scripts/dictionary/vendor/pinyin/phrases_dict.json.gz').read_bytes()))
    by={}
    for phrase,reading in result['phraseReadings'].items():by.setdefault(phrase[0],[]).append((phrase,reading))
    for group in by.values():group.sort(key=lambda item:-len(item[0]))
    for word,values in phrases.items():
        if len(word)<2 or len(word)!=len(values) or not all(values):continue
        actual=[];i=0
        while i<len(word):
            hit=next(((key,reading) for key,reading in by.get(word[i],[]) if word.startswith(key,i)),None)
            if hit:actual+=hit[1];i+=len(hit[0])
            else:actual.append(result['readings'].get(word[i],word[i]));i+=1
        assert actual==[toneless(part[0]) for part in values],word
    snapshot=target/'scripts/dictionary/vendor/pinyin/phrases_dict.json.gz'
    snapshot.write_bytes(snapshot.read_bytes()+b'tampered')
    try:build(target)
    except ValueError as error:assert 'checksum mismatch' in str(error)
    else:raise AssertionError('Tampered phrase snapshot accepted')
`;
  const result = spawnSync("python3", ["-c", script, root], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
