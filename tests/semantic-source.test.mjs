import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

test("semantic concepts reject changed evidence, wrong target labels and stale source versions", () => {
  const script = `
import json,sys,tempfile,pathlib
sys.path.insert(0,sys.argv[1])
from semantic_search import build_semantic
data={'schemaVersion':1,'baseDataVersion':'base','records':[{'id':'happy','lemma':'felic','label':'开心','expressions':['心情好'],'evidence':[{'layer':'wiktionary','field':'d.en','text':'happy'}]}]}
records={'felic':[('wiktionary',{'p':['adjective'],'d':{'en':['happy']}})]};entries={'felic':{'r':1,'p':['adjective','noun']}}
indexes={'zh':[['开心',[['felic','开心','alias',1]]]]}
with tempfile.TemporaryDirectory() as directory:
 p=pathlib.Path(directory)/'concepts.json'
 def run(value):
  p.write_text(json.dumps(value))
  return build_semantic(p,records,entries,'base',lambda s:s,lambda s:s,lambda s:s.encode('utf-16-be'),indexes)
 assert run(data)[0][0][:4]==['心情好','心情好','felic','开心']
 typed=json.loads(json.dumps(data));typed['records'][0]['partOfSpeech']='adjective'
 assert run(typed)[0][0][6]=='adjective'
 for mode in ('source','version','label','id','unknown','spanish','class'):
  changed=json.loads(json.dumps(data));item=changed['records'][0]
  if mode=='source':item['evidence'][0]['text']='unhappy'
  elif mode=='version':changed['baseDataVersion']='stale'
  elif mode=='label':item['label']='难过'
  elif mode=='id':changed['records'].append(item)
  elif mode=='unknown':item['lemma']='unknown'
  elif mode=='class':item['partOfSpeech']='noun'
  else:item['evidence']=[{'layer':'wiktionary','field':'es','text':'feliz'}]
  try:run(changed)
  except ValueError:pass
  else:raise AssertionError('Unbound concept accepted: '+mode)
`;
  const result = spawnSync("python3", ["-c", script, resolve("scripts/dictionary")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
