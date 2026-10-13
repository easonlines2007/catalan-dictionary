import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
`;
  const result = spawnSync("python3", ["-c", script, resolve(root, "scripts/dictionary")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
