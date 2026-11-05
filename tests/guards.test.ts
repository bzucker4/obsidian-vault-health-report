import { it, expect } from "vitest";
import { buildIndex } from "../src/index";
import { detectLookalikeKeys, detectNearDuplicateValues } from "../src/detectors";
import { isSpellingDistanceOne } from "../src/normalize";
const mk = (fms: Record<string, unknown>[]) => fms.map((f, i) => ({ path: `n${i}.md`, frontmatter: f }));
const rep = (n: number, f: Record<string, unknown>) => Array.from({ length: n }, () => f);
it("guard 1: 20 real-word keys, 1 note each -> zero lookalike groups", () => {
  const keys = ["title","topic","price","place","state","stats","notes","nodes","links","lines","start","stars","rating","dating","source","course","author","status","project","people"];
  expect(detectLookalikeKeys(buildIndex(mk(keys.map(k => ({ [k]: "x" })))))).toEqual([]);
});
it("guard 2: status x10, stauts x1 -> one spelling group", () => {
  const g = detectLookalikeKeys(buildIndex(mk([...rep(10, { status: "a" }), { stauts: "a" }])));
  expect(g).toHaveLength(1); expect(g[0].reason).toBe("spelling");
});
it("guard 3: values state, stats, notes, nodes -> zero value groups", () => {
  expect(detectNearDuplicateValues(buildIndex(mk(["state","stats","notes","nodes"].map(v => ({ type: v })))))).toEqual([]);
});
it("guard 4: pending x10, pendng x1 -> one spelling group", () => {
  const g = detectNearDuplicateValues(buildIndex(mk([...rep(10, { s: "pending" }), { s: "pendng" }])));
  expect(g).toHaveLength(1); expect(g[0].reason).toBe("spelling");
});
it("extra: equally common rating/dating still apart; rare 'ratnig' joins rating", () => {
  expect(detectLookalikeKeys(buildIndex(mk([...rep(5, { rating: 1 }), ...rep(5, { dating: 1 })])))).toEqual([]);
  expect(detectLookalikeKeys(buildIndex(mk([...rep(9, { rating: 1 }), { ratnig: 1 }])))).toHaveLength(1);
  expect(isSpellingDistanceOne("state", "stats")).toBe(false);
  expect(isSpellingDistanceOne("field1", "field2")).toBe(false);
});
it("negative check: a 1-vs-1 typo pair is NOT grouped (ratio rule is live)", () => {
  expect(detectLookalikeKeys(buildIndex(mk([{ category: 1 }, { catagory: 1 }])))).toEqual([]);
});
