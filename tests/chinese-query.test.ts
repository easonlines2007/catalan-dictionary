import assert from "node:assert/strict";
import test from "node:test";
import { extractChineseSearchTerm } from "../lib/chinese-query.ts";

test("explicit dictionary questions retain their complete search term", () => {
  for (const [query, expected] of [
    ["学校用加泰语怎么说？", "学校"], ["請問，學校的加泰羅尼亞語是什麼？", "学校"],
    ["“热水”怎么说", "热水"], ["加泰语怎么说：公交车", "公交车"],
    ["我不知道用加泰语怎么说", "我不知道"], ["不可以怎么说", "不可以"],
    ["二月用catala怎么说", "二月"], ["请用加泰语怎么说", "请"],
    ["学校怎么说呢", "学校"], ["加泰语怎么写电话", "电话"],
    ["学校用 Català 怎么说", "学校"], ["学校在加泰语里怎么说", "学校"],
    ["学校加泰语怎么说", "学校"], ["学校翻译成加泰语", "学校"],
    ["学校的加泰语怎么说", "学校"],
  ]) assert.equal(extractChineseSearchTerm(query), expected, query);
});

test("ordinary phrases, other target languages and nested questions stay untouched", () => {
  for (const query of ["学校", "请", "我想去学校", "学校用西班牙语怎么说", "学校的英语怎么写",
    "请翻译我今天去了学校", "hello用加泰语怎么说", "学校怎么说怎么说", "怎么说", "学校，公交车怎么说",
    `${"学".repeat(25)}怎么说`]) assert.equal(extractChineseSearchTerm(query), undefined, query);
});

test("explicit meaning requests retain the entire description, including negation and quantity", () => {
  for (const [query, expected] of [
    ["表示价格不高的词", "价格不高"], ["形容有点难过的加泰语单词", "有点难过"],
    ["我想找一个表示不用付钱的词", "不用付钱"], ["有没有一个形容不开心的词", "不开心"],
    ["加泰语里表示“借给别人”的词", "借给别人"], ["一个意思是重量小的词语", "重量小"],
    ["加泰罗尼亚语中形容体积小的单词", "体积小"], ["请问，表示二月的加泰语说法？", "二月"],
    ["形容不是很开心的词", "不是很开心"], ["表示“免费的”的词", "免费的"],
    ["表示‘没有说不安全’的词", "没有说不安全"],
  ]) assert.equal(extractChineseSearchTerm(query), expected, query);
  for (const query of ["形容词", "表示价格不高", "表示难过的英语词", "形容开心的西班牙语单词",
    "英语里表示难过的词", "形容表示难过的词的词", "表示学校，公交车的词", "表示hello的词"])
    assert.equal(extractChineseSearchTerm(query), undefined, query);
});
