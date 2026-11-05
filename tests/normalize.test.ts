import { describe, it, expect } from "vitest";
import {
	wordKey,
	normValue,
	sepNormValue,
	isPluralPair,
	damerauLevenshtein,
	isSpellingDistanceOne,
	matchDatePattern,
	classifyValueType,
} from "../src/normalize";

describe("wordKey", () => {
	it("normalizes camelCase, spaces, underscores, and hyphens to hyphen-joined lowercase words", () => {
		expect(wordKey("dueDate")).toBe("due-date");
		expect(wordKey("Due Date")).toBe("due-date");
		expect(wordKey("due_date")).toBe("due-date");
		expect(wordKey("due-date")).toBe("due-date");
		expect(wordKey("due.date")).toBe("due-date");
	});
});

describe("normValue", () => {
	it("trims, lowercases, collapses spaces, strips one leading #, and strips [[ ]] around wikilinks", () => {
		expect(normValue("#Idea")).toBe("idea");
		expect(normValue("[[Project X]]")).toBe("project x");
		expect(normValue("  In   Progress  ")).toBe("in progress");
		expect(normValue("##heading")).toBe("#heading");
	});
});

describe("sepNormValue", () => {
	it("treats -, _ and spaces as the same", () => {
		expect(sepNormValue(normValue("in-progress"))).toBe("in progress");
		expect(sepNormValue(normValue("in_progress"))).toBe("in progress");
		expect(sepNormValue(normValue("In Progress"))).toBe("in progress");
	});
});

describe("isPluralPair", () => {
	it("matches +s, +es, and y -> ies", () => {
		expect(isPluralPair("tag", "tags")).toBe(true);
		expect(isPluralPair("category", "categories")).toBe(true);
		expect(isPluralPair("status", "statuses")).toBe(true);
		expect(isPluralPair("date", "dates")).toBe(true);
		expect(isPluralPair("date", "created")).toBe(false);
	});
});

describe("damerauLevenshtein & isSpellingDistanceOne", () => {
	it("computes distance 1 for substitution, deletion, insertion, and transposition", () => {
		expect(damerauLevenshtein("catagory", "category")).toBe(1);
		expect(damerauLevenshtein("pending", "pendng")).toBe(1);
		expect(damerauLevenshtein("status", "stauts")).toBe(1);
		expect(isSpellingDistanceOne("catagory", "category")).toBe(true);
		expect(isSpellingDistanceOne("pending", "pendng")).toBe(true);
		expect(isSpellingDistanceOne("status", "stauts")).toBe(true);
	});

	it("rejects strings shorter than 5 characters", () => {
		expect(isSpellingDistanceOne("name", "game")).toBe(false);
		expect(isSpellingDistanceOne("tag", "tags")).toBe(false);
	});

	it("rejects digit-only differences", () => {
		expect(isSpellingDistanceOne("link1", "link2")).toBe(false);
		expect(isSpellingDistanceOne("note", "note1")).toBe(false);
		expect(isSpellingDistanceOne("item1", "item12")).toBe(false);
	});
});

describe("matchDatePattern", () => {
	it("recognizes all 6 date patterns from the spec", () => {
		expect(matchDatePattern("2026-11-04")).toBe("ISO date");
		expect(matchDatePattern("2026-11-04T09:30")).toBe("ISO datetime");
		expect(matchDatePattern("2026-11-04 09:30:00")).toBe("ISO datetime");
		expect(matchDatePattern("11/04/2026")).toBe("Slash date");
		expect(matchDatePattern("04.11.2026")).toBe("Dotted date");
		expect(matchDatePattern("20261104")).toBe("Compact");
		expect(matchDatePattern("Nov 4, 2026")).toBe("Written");
		expect(matchDatePattern("4 November 2026")).toBe("Written");
	});

	it("does not match version strings like 1.2.3 as dotted dates", () => {
		expect(matchDatePattern("1.2.3")).toBeNull();
	});
});

describe("classifyValueType", () => {
	it("classifies values into the 8 spec types", () => {
		expect(classifyValueType(null)).toBe("empty");
		expect(classifyValueType("")).toBe("empty");
		expect(classifyValueType([])).toBe("empty");
		expect(classifyValueType(["a", "b"])).toBe("list");
		expect(classifyValueType(4)).toBe("number");
		expect(classifyValueType("4")).toBe("text");
		expect(classifyValueType(true)).toBe("boolean");
		expect(classifyValueType("2026-11-04")).toBe("date");
		expect(classifyValueType("2026-11-04T09:30")).toBe("datetime");
		expect(classifyValueType("[[Project X]]")).toBe("wikilink");
		expect(classifyValueType("idea")).toBe("text");
	});
});
