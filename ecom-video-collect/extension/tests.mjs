import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRecord } from "./src/schema.mjs";

const context = { URL };
runInNewContext(readFileSync(new URL("./src/detail-extractor.js", import.meta.url), "utf8"), context);
const parse = context.KSDetailExtractor.parseText;
const url = "https://cps.kwaixiaodian.com/pc/promoter/selection-center/detail?relItemId=25762544052958";
const page = "选品中心\n示例加厚香氛垃圾袋家用手提式塑料袋\nID: 25762544052958\n售价 ¥3.01\n佣金率 10%\n商品规格：100只装\n商品类目：家居百货 > 清洁用品 > 垃圾袋\n加入货架";

test("extracts explicit product fields", () => {
  const result = parse(page, url);
  const record = createRecord(result.fields);
  assert.equal(result.status, "ok");
  assert.equal(record.specification, "100只装");
  assert.equal(record.category.name, "垃圾袋");
  assert.equal(record.price.min, 3.01);
  assert.equal(record.commission.percent, 10);
});
test("missing optional fields stay empty", () => {
  const result = parse(page.replace("商品规格：100只装\n", "").replace("商品类目：家居百货 > 清洁用品 > 垃圾袋\n", ""), url);
  assert.equal(result.status, "ok");
  assert.equal(result.fields.specification, null);
  assert.equal(result.fields.categoryName, null);
});
test("wrong or unverified ID is rejected", () => {
  assert.equal(parse(page, url.replace("25762544052958", "11111111111111")).status, "id_mismatch");
  assert.equal(parse(page.replace("ID: 25762544052958\n", ""), url).status, "id_unverified");
});
