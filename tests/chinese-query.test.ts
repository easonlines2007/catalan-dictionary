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
  ]) assert.equal(extractChineseSearchTerm(query), expected, query);
});

test("ordinary phrases, other target languages and nested questions stay untouched", () => {
  for (const query of ["学校", "请", "我想去学校", "学校用西班牙语怎么说", "学校的英语怎么写",
    "请翻译我今天去了学校", "hello用加泰语怎么说", "学校怎么说怎么说", "怎么说", "学校，公交车怎么说",
    `${"学".repeat(25)}怎么说`]) assert.equal(extractChineseSearchTerm(query), undefined, query);
});
