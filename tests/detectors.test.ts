import { describe, it, expect } from "vitest";
import { buildIndex, NoteFrontmatterInput } from "../src/index";
import {
	detectLookalikeKeys,
	detectNearDuplicateValues,
	detectMixedValueTypes,
	detectMixedDateFormats,
	detectRareKeys,
	lookupPropertyByValue,
	runAllDetectors,
} from "../src/detectors";

function makeNotes(
	frontmatters: Record<string, unknown>[]
): NoteFrontmatterInput[] {
	return frontmatters.map((fm, idx) => ({
		path: `note-${idx + 1}.md`,
		frontmatter: fm,
	}));
}

describe("Vault Health Report - All 23 Spec Test Cases", () => {
	it("Case 1: tags × 5, Tags × 2, tag × 1 -> One lookalike group: tags (5) · Tags (2) · tag (1)", () => {
		const notes = makeNotes([
			{ tags: ["a"] },
			{ tags: ["b"] },
			{ tags: ["c"] },
			{ tags: ["d"] },
			{ tags: ["e"] },
			{ Tags: ["a"] },
			{ Tags: ["b"] },
			{ tag: "a" },
		]);
		const index = buildIndex(notes);
		const groups = detectLookalikeKeys(index);

		expect(groups).toHaveLength(1);
		expect(groups[0].variants.map((v) => `${v.label} (${v.count})`)).toEqual([
			"tags (5)",
			"Tags (2)",
			"tag (1)",
		]);
	});

	it("Case 2: due-date, due_date, dueDate -> One group, reason separator", () => {
		const notes = makeNotes([
			{ "due-date": "2026-01-01" },
			{ due_date: "2026-01-02" },
			{ dueDate: "2026-01-03" },
		]);
		const index = buildIndex(notes);
		const groups = detectLookalikeKeys(index);

		expect(groups).toHaveLength(1);
		expect(groups[0].reason).toBe("separator");
	});

	it("Case 3: created, date-created, created_at -> One group, reason synonym", () => {
		const notes = makeNotes([
			{ created: "2026-01-01" },
			{ "date-created": "2026-01-02" },
			{ created_at: "2026-01-03" },
		]);
		const index = buildIndex(notes);
		const groups = detectLookalikeKeys(index);

		expect(groups).toHaveLength(1);
		expect(groups[0].reason).toBe("synonym");
	});

	it("Case 4: category, categories, catagory -> One group: plural and spelling joined", () => {
		const notes = makeNotes([
			...Array.from({ length: 6 }, () => ({ category: "work" })),
			...Array.from({ length: 2 }, () => ({ categories: ["work"] })),
			{ catagory: "work" },
		]);
		const index = buildIndex(notes);
		const groups = detectLookalikeKeys(index);

		expect(groups).toHaveLength(1);
		expect(groups[0].variants.map((v) => v.label).sort()).toEqual([
			"catagory",
			"categories",
			"category",
		]);
	});

	it("Case 5: date, dates -> One group, reason plural", () => {
		const notes = makeNotes([
			{ date: "2026-01-01" },
			{ dates: "2026-01-02" },
		]);
		const index = buildIndex(notes);
		const groups = detectLookalikeKeys(index);

		expect(groups).toHaveLength(1);
		expect(groups[0].reason).toBe("plural");
	});

	it("Case 6: date, created -> No group: date is in no synonym set", () => {
		const notes = makeNotes([
			{ date: "2026-01-01" },
			{ created: "2026-01-02" },
		]);
		const index = buildIndex(notes);
		const groups = detectLookalikeKeys(index);

		expect(groups).toHaveLength(0);
	});

	it("Case 7: link1, link2 -> No group: digit-only difference", () => {
		const notes = makeNotes([
			{ link1: "[[A]]" },
			{ link2: "[[B]]" },
		]);
		const index = buildIndex(notes);
		const groups = detectLookalikeKeys(index);

		expect(groups).toHaveLength(0);
	});

	it("Case 8: name, game -> No group: under 5 characters", () => {
		const notes = makeNotes([
			{ name: "Alice" },
			{ game: "Chess" },
		]);
		const index = buildIndex(notes);
		const groups = detectLookalikeKeys(index);

		expect(groups).toHaveLength(0);
	});

	it("Case 9: status: Done × 4, done × 2, complete × 1, todo × 3 -> One value group: Done · done · complete. todo stays out", () => {
		const notes = makeNotes([
			{ status: "Done" },
			{ status: "Done" },
			{ status: "Done" },
			{ status: "Done" },
			{ status: "done" },
			{ status: "done" },
			{ status: "complete" },
			{ status: "todo" },
			{ status: "todo" },
			{ status: "todo" },
		]);
		const index = buildIndex(notes);
		const groups = detectNearDuplicateValues(index);

		expect(groups).toHaveLength(1);
		expect(groups[0].key).toBe("status");
		expect(groups[0].variants.map((v) => `${v.label} (${v.count})`)).toEqual([
			"Done (4)",
			"done (2)",
			"complete (1)",
		]);
	});

	it("Case 10: status: in-progress, in progress, In Progress -> One value group", () => {
		const notes = makeNotes([
			{ status: "in-progress" },
			{ status: "in progress" },
			{ status: "In Progress" },
		]);
		const index = buildIndex(notes);
		const groups = detectNearDuplicateValues(index);

		expect(groups).toHaveLength(1);
		expect(groups[0].variants.map((v) => v.label).sort()).toEqual([
			"In Progress",
			"in progress",
			"in-progress",
		]);
	});

	it("Case 11: title with 200 different strings -> No value groups: free-text key skipped", () => {
		const notes = makeNotes(
			Array.from({ length: 200 }, (_, i) => ({
				title: `Unique Note Title Number ${i + 1}`,
			}))
		);
		const index = buildIndex(notes);
		const groups = detectNearDuplicateValues(index);

		expect(groups).toHaveLength(0);
	});

	it("Case 12: tags: idea in 3 notes, tags: [idea, draft] in 7 -> Mixed types: list (7) · text (3)", () => {
		const notes = makeNotes([
			...Array.from({ length: 3 }, () => ({ tags: "idea" })),
			...Array.from({ length: 7 }, () => ({ tags: ["idea", "draft"] })),
		]);
		const index = buildIndex(notes);
		const groups = detectMixedValueTypes(index);

		expect(groups).toHaveLength(1);
		expect(groups[0].key).toBe("tags");
		expect(groups[0].types.map((t) => `${t.type} (${t.count})`)).toEqual([
			"list (7)",
			"text (3)",
		]);
	});

	it("Case 13: rating: 4 and rating: '4' -> Mixed types: number · text", () => {
		const notes = makeNotes([{ rating: 4 }, { rating: "4" }]);
		const index = buildIndex(notes);
		const groups = detectMixedValueTypes(index);

		expect(groups).toHaveLength(1);
		expect(groups[0].key).toBe("rating");
		expect(groups[0].types.map((t) => t.type).sort()).toEqual([
			"number",
			"text",
		]);
	});

	it("Case 14: due: empty in 2 notes, ISO dates in 8 -> No type report: empties alone don't count", () => {
		const notes = makeNotes([
			{ due: null },
			{ due: "" },
			...Array.from({ length: 8 }, () => ({ due: "2026-11-04" })),
		]);
		const index = buildIndex(notes);
		const groups = detectMixedValueTypes(index);

		expect(groups).toHaveLength(0);
	});

	it("Case 15: created: 2026-01-05, 01/05/2026, Jan 5, 2026 -> Mixed date formats: ISO date · Slash date · Written", () => {
		const notes = makeNotes([
			{ created: "2026-01-05" },
			{ created: "01/05/2026" },
			{ created: "Jan 5, 2026" },
		]);
		const index = buildIndex(notes);
		const groups = detectMixedDateFormats(index);

		expect(groups).toHaveLength(1);
		expect(groups[0].key).toBe("created");
		expect(groups[0].formats.map((f) => f.pattern)).toEqual([
			"ISO date",
			"Slash date",
			"Written",
		]);
	});

	it("Case 16: created: ISO dates only -> No date report", () => {
		const notes = makeNotes([
			{ created: "2026-01-05" },
			{ created: "2026-02-10" },
			{ created: "2026-03-15" },
		]);
		const index = buildIndex(notes);
		const groups = detectMixedDateFormats(index);

		expect(groups).toHaveLength(0);
	});

	it("Case 17: version: 1.2.3 in all notes -> Not a date key", () => {
		const notes = makeNotes([
			{ version: "1.2.3" },
			{ version: "2.0.1" },
			{ version: "2026-01-05" },
		]);
		const index = buildIndex(notes);
		const groups = detectMixedDateFormats(index);

		expect(groups).toHaveLength(0);
	});

	it("Case 18: 25 notes; mood in 2 notes, tags in 20 -> Rare keys: mood (2)", () => {
		const notes = makeNotes(
			Array.from({ length: 25 }, (_, i) => {
				const fm: Record<string, unknown> = {};
				if (i < 2) fm.mood = "happy";
				if (i < 20) fm.tags = ["note"];
				return fm;
			})
		);
		const index = buildIndex(notes);
		const rare = detectRareKeys(index);

		expect(rare).toHaveLength(1);
		expect(rare[0].key).toBe("mood");
		expect(rare[0].count).toBe(2);
	});

	it("Case 19: 10 notes; mood in 2 notes -> No rare keys: under 20 notes", () => {
		const notes = makeNotes(
			Array.from({ length: 10 }, (_, i) => (i < 2 ? { mood: "happy" } : {}))
		);
		const index = buildIndex(notes);
		const rare = detectRareKeys(index);

		expect(rare).toHaveLength(0);
	});

	it("Case 20: Tag in 1 note, tags in 20, 25 notes total -> Tag appears in the lookalike group, not in rare keys", () => {
		const notes = makeNotes(
			Array.from({ length: 25 }, (_, i) => {
				if (i === 0) return { Tag: ["one"] };
				if (i <= 20) return { tags: ["many"] };
				return {};
			})
		);
		const index = buildIndex(notes);
		const report = runAllDetectors(index);

		expect(report.lookalikeKeys).toHaveLength(1);
		expect(
			report.lookalikeKeys[0].variants.map((v) => v.label)
		).toContain("Tag");
		expect(report.rareKeys.map((r) => r.key)).not.toContain("Tag");
	});

	it("Case 21: meta: {a: 1} -> Listed under 'Not scanned: nested values', in no detector", () => {
		const notes = makeNotes(
			Array.from({ length: 25 }, (_, i) =>
				i === 0 ? { meta: { a: 1 }, tags: ["x"] } : { tags: ["x"] }
			)
		);
		const index = buildIndex(notes);
		const report = runAllDetectors(index);

		expect(report.nestedKeys.map((n) => n.key)).toEqual(["meta"]);
		expect(report.lookalikeKeys).toHaveLength(0);
		expect(report.nearDuplicateValues).toHaveLength(0);
		expect(report.mixedTypes).toHaveLength(0);
		expect(report.mixedDateFormats).toHaveLength(0);
		expect(report.rareKeys.map((r) => r.key)).not.toContain("meta");
	});

	it("Case 22: Lookup 'accommodation' when type × 3 and category × 2 hold it -> Two result rows: type (3), category (2)", () => {
		const notes = makeNotes([
			{ type: "accommodation" },
			{ type: "Accommodation" },
			{ type: "accommodation" },
			{ category: "accommodation" },
			{ category: "accommodation" },
		]);
		const index = buildIndex(notes);
		const results = lookupPropertyByValue(index, "accommodation");

		expect(results.map((r) => `${r.key} (${r.count})`)).toEqual([
			"type (3)",
			"category (2)",
		]);
	});

	it("Case 23: Lookalike group dismissed in settings -> Group hidden, shown again with 'Show dismissed'", () => {
		const notes = makeNotes([
			{ tags: ["a"] },
			{ Tags: ["b"] },
		]);
		const index = buildIndex(notes);
		const initial = detectLookalikeKeys(index);
		expect(initial).toHaveLength(1);

		const groupId = initial[0].id;

		const hidden = detectLookalikeKeys(index, {
			dismissedGroups: [groupId],
			showDismissed: false,
		});
		expect(hidden).toHaveLength(0);

		const shownAgain = detectLookalikeKeys(index, {
			dismissedGroups: [groupId],
			showDismissed: true,
		});
		expect(shownAgain).toHaveLength(1);
	});
});
