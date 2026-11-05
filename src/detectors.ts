import { VaultIndex } from "./index";
import {
	DatePatternName,
	ValueType,
	isPluralPair,
	isSpellingDistanceOne,
	normValue,
	sepNormValue,
	wordKey,
} from "./normalize";

export type KeyDriftReason =
	| "case"
	| "separator"
	| "plural"
	| "synonym"
	| "spelling";

export type ValueDriftReason = "case" | "separator" | "synonym" | "spelling";

export type DriftReason =
	| KeyDriftReason
	| ValueDriftReason
	| "type"
	| "date format"
	| "rare";

export interface VariantItem {
	label: string;
	count: number;
	notes: string[];
}

export interface LookalikeKeyGroup {
	id: string;
	section: "lookalike-keys";
	reason: KeyDriftReason;
	variants: VariantItem[];
}

export interface NearDuplicateValueGroup {
	id: string;
	section: "near-duplicate-values";
	key: string;
	reason: ValueDriftReason;
	variants: VariantItem[];
}

export interface MixedTypeVariant {
	type: ValueType;
	count: number;
	examples: string[];
}

export interface MixedTypeGroup {
	id: string;
	section: "mixed-types";
	key: string;
	reason: "type";
	types: MixedTypeVariant[];
	emptyCount: number;
	emptyExamples: string[];
}

export interface DateFormatVariant {
	pattern: DatePatternName;
	count: number;
	exampleRaw: string;
	notes: string[];
}

export interface MixedDateFormatGroup {
	id: string;
	section: "mixed-dates";
	key: string;
	reason: "date format";
	formats: DateFormatVariant[];
}

export interface RareKeyGroup {
	id: string;
	section: "rare-keys";
	key: string;
	reason: "rare";
	count: number;
	notes: string[];
}

export interface LookupResultRow {
	key: string;
	count: number;
	notes: string[];
	matchedSpellings: { raw: string; count: number }[];
}

export interface DetectorSettings {
	rareKeyThreshold?: number;
	enableSpellingDistance?: boolean;
	keySynonymSets?: string[][];
	valueSynonymSets?: string[][];
	dismissedGroups?: Iterable<string>;
	showDismissed?: boolean;
}

export interface FullReport {
	lookalikeKeys: LookalikeKeyGroup[];
	nearDuplicateValues: NearDuplicateValueGroup[];
	mixedTypes: MixedTypeGroup[];
	mixedDateFormats: MixedDateFormatGroup[];
	rareKeys: RareKeyGroup[];
	nestedKeys: { key: string; count: number; notes: string[] }[];
	totalDriftGroups: number;
}

export const DEFAULT_KEY_SYNONYM_SETS: string[][] = [
	["created", "date-created", "created-at", "creation-date", "created-on"],
	["updated", "modified", "last-modified", "updated-at", "date-modified"],
	["alias", "aliases"],
	["due", "due-date", "deadline"],
	["tag", "tags"],
];

export const DEFAULT_VALUE_SYNONYM_SETS: string[][] = [
	["done", "complete", "completed", "finished"],
	["todo", "to-do", "not started", "backlog"],
	["in progress", "wip", "doing", "active"],
];

const KEY_REASON_PRIORITY: Record<KeyDriftReason, number> = {
	case: 1,
	separator: 2,
	plural: 3,
	synonym: 4,
	spelling: 5,
};

const VALUE_REASON_PRIORITY: Record<ValueDriftReason, number> = {
	case: 1,
	separator: 2,
	synonym: 3,
	spelling: 4,
};

class UnionFind {
	private parent: number[];
	private rank: number[];

	constructor(size: number) {
		this.parent = Array.from({ length: size }, (_, i) => i);
		this.rank = new Array<number>(size).fill(0);
	}

	find(i: number): number {
		if (this.parent[i] !== i) {
			this.parent[i] = this.find(this.parent[i]);
		}
		return this.parent[i];
	}

	union(i: number, j: number): void {
		const rootI = this.find(i);
		const rootJ = this.find(j);
		if (rootI === rootJ) return;
		if (this.rank[rootI] < this.rank[rootJ]) {
			this.parent[rootI] = rootJ;
		} else if (this.rank[rootI] > this.rank[rootJ]) {
			this.parent[rootJ] = rootI;
		} else {
			this.parent[rootJ] = rootI;
			this.rank[rootI] += 1;
		}
	}
}

function sortVariantsDesc(variants: VariantItem[]): VariantItem[] {
	return variants.sort((a, b) => {
		if (b.count !== a.count) return b.count - a.count;
		return a.label.localeCompare(b.label);
	});
}

function areInSameKeySynonymSet(
	wkA: string,
	wkB: string,
	normalizedSets: Set<string>[]
): boolean {
	for (const set of normalizedSets) {
		if (set.has(wkA) && set.has(wkB)) return true;
	}
	return false;
}

function hasSpellingCountRatio(countA: number, countB: number): boolean {
	const less = Math.min(countA, countB);
	const more = Math.max(countA, countB);
	return less * 3 <= more;
}

function matchKeyPair(
	rawA: string,
	wkA: string,
	countA: number,
	rawB: string,
	wkB: string,
	countB: number,
	synonymSets: Set<string>[],
	enableSpelling: boolean
): KeyDriftReason | null {
	if (rawA.toLowerCase() === rawB.toLowerCase()) {
		return "case";
	}
	if (wkA === wkB) {
		return "separator";
	}
	if (isPluralPair(wkA, wkB)) {
		return "plural";
	}
	if (areInSameKeySynonymSet(wkA, wkB, synonymSets)) {
		return "synonym";
	}
	if (
		enableSpelling &&
		hasSpellingCountRatio(countA, countB) &&
		isSpellingDistanceOne(wkA, wkB)
	) {
		return "spelling";
	}
	return null;
}

export function detectLookalikeKeys(
	index: VaultIndex,
	settings: DetectorSettings = {}
): LookalikeKeyGroup[] {
	const rawKeys = Array.from(index.keys.keys()).filter(
		(k) => !index.nested.has(k)
	);
	const n = rawKeys.length;
	if (n < 2) return [];

	const enableSpelling = settings.enableSpellingDistance ?? true;
	const rawSynSets = settings.keySynonymSets ?? DEFAULT_KEY_SYNONYM_SETS;
	const normalizedSynSets = rawSynSets.map(
		(set) => new Set(set.map((item) => wordKey(item)))
	);

	const wordKeys = rawKeys.map((k) => wordKey(k));
	const keyCounts = rawKeys.map((k) => index.keys.get(k)?.size ?? 0);
	const uf = new UnionFind(n);
	const pairReasons = new Map<string, KeyDriftReason>();

	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const reason = matchKeyPair(
				rawKeys[i],
				wordKeys[i],
				keyCounts[i],
				rawKeys[j],
				wordKeys[j],
				keyCounts[j],
				normalizedSynSets,
				enableSpelling
			);
			if (reason !== null) {
				uf.union(i, j);
				pairReasons.set(`${i}:${j}`, reason);
			}
		}
	}

	const components = new Map<number, number[]>();
	for (let i = 0; i < n; i++) {
		const root = uf.find(i);
		let list = components.get(root);
		if (!list) {
			list = [];
			components.set(root, list);
		}
		list.push(i);
	}

	const groups: LookalikeKeyGroup[] = [];
	for (const members of components.values()) {
		if (members.length < 2) continue;

		let bestReason: KeyDriftReason = "spelling";
		let bestPriority = Infinity;

		for (let a = 0; a < members.length; a++) {
			for (let b = a + 1; b < members.length; b++) {
				const idx1 = Math.min(members[a], members[b]);
				const idx2 = Math.max(members[a], members[b]);
				const r = pairReasons.get(`${idx1}:${idx2}`);
				if (r && KEY_REASON_PRIORITY[r] < bestPriority) {
					bestPriority = KEY_REASON_PRIORITY[r];
					bestReason = r;
				}
			}
		}

		const variants: VariantItem[] = members.map((idx) => {
			const k = rawKeys[idx];
			const paths = Array.from(index.keys.get(k) ?? []).sort();
			return {
				label: k,
				count: paths.length,
				notes: paths,
			};
		});

		sortVariantsDesc(variants);

		const sortedLabels = variants
			.map((v) => v.label)
			.slice()
			.sort();
		const id = `lookalike-keys:${sortedLabels.join("|")}`;

		groups.push({
			id,
			section: "lookalike-keys",
			reason: bestReason,
			variants,
		});
	}

	groups.sort((a, b) => {
		const sumA = a.variants.reduce((acc, v) => acc + v.count, 0);
		const sumB = b.variants.reduce((acc, v) => acc + v.count, 0);
		if (sumB !== sumA) return sumB - sumA;
		return a.variants[0].label.localeCompare(b.variants[0].label);
	});

	return filterDismissed(groups, settings);
}

function areInSameValueSynonymSet(
	sepA: string,
	sepB: string,
	normalizedSets: Set<string>[]
): boolean {
	for (const set of normalizedSets) {
		if (set.has(sepA) && set.has(sepB)) return true;
	}
	return false;
}

export function detectNearDuplicateValues(
	index: VaultIndex,
	settings: DetectorSettings = {}
): NearDuplicateValueGroup[] {
	const enableSpelling = settings.enableSpellingDistance ?? true;
	const rawSynSets = settings.valueSynonymSets ?? DEFAULT_VALUE_SYNONYM_SETS;
	const normalizedSynSets = rawSynSets.map(
		(set) => new Set(set.map((item) => sepNormValue(normValue(item))))
	);

	const groups: NearDuplicateValueGroup[] = [];

	for (const [rawKey, normMap] of index.values.entries()) {
		if (index.nested.has(rawKey)) continue;

		let distinctRawCount = 0;
		for (const entry of normMap.values()) {
			distinctRawCount += entry.rawCounts.size;
		}
		if (distinctRawCount > 150 || normMap.size > 150) {
			continue;
		}

		const stats = index.stringStats.get(rawKey);
		if (stats && stats.totalCount > 0) {
			const avgLen = stats.totalLength / stats.totalCount;
			if (avgLen > 40) continue;
		}

		const normKeys = Array.from(normMap.keys());
		const sepKeys = normKeys.map((nk) => sepNormValue(nk));
		const normNoteCounts = normKeys.map(
			(nk) => normMap.get(nk)?.paths.size ?? 0
		);
		const m = normKeys.length;
		if (m === 0) continue;

		const uf = new UnionFind(m);
		const pairReasons = new Map<string, ValueDriftReason>();

		for (let i = 0; i < m; i++) {
			for (let j = i + 1; j < m; j++) {
				let reason: ValueDriftReason | null = null;
				if (sepKeys[i] === sepKeys[j]) {
					reason = "separator";
				} else if (
					areInSameValueSynonymSet(
						sepKeys[i],
						sepKeys[j],
						normalizedSynSets
					)
				) {
					reason = "synonym";
				} else if (
					enableSpelling &&
					hasSpellingCountRatio(
						normNoteCounts[i],
						normNoteCounts[j]
					) &&
					isSpellingDistanceOne(normKeys[i], normKeys[j])
				) {
					reason = "spelling";
				}

				if (reason !== null) {
					uf.union(i, j);
					pairReasons.set(`${i}:${j}`, reason);
				}
			}
		}

		const components = new Map<number, number[]>();
		for (let i = 0; i < m; i++) {
			const root = uf.find(i);
			let list = components.get(root);
			if (!list) {
				list = [];
				components.set(root, list);
			}
			list.push(i);
		}

		for (const members of components.values()) {
			const variants: VariantItem[] = [];
			for (const idx of members) {
				const entry = normMap.get(normKeys[idx])!;
				for (const [rawSpelling, count] of entry.rawCounts.entries()) {
					const paths = Array.from(
						entry.rawPaths.get(rawSpelling) ?? []
					).sort();
					variants.push({
						label: rawSpelling,
						count,
						notes: paths,
					});
				}
			}

			if (variants.length < 2) continue;

			let bestReason: ValueDriftReason = "spelling";
			let bestPriority = Infinity;

			const hasSameNormVariant = members.some(
				(idx) => (normMap.get(normKeys[idx])?.rawCounts.size ?? 0) > 1
			);

			if (members.length === 1 && hasSameNormVariant) {
				bestReason = "case";
				bestPriority = VALUE_REASON_PRIORITY.case;
			} else {
				for (let a = 0; a < members.length; a++) {
					for (let b = a + 1; b < members.length; b++) {
						const idx1 = Math.min(members[a], members[b]);
						const idx2 = Math.max(members[a], members[b]);
						const r = pairReasons.get(`${idx1}:${idx2}`);
						if (r && VALUE_REASON_PRIORITY[r] < bestPriority) {
							bestPriority = VALUE_REASON_PRIORITY[r];
							bestReason = r;
						}
					}
				}
			}

			sortVariantsDesc(variants);

			const sortedLabels = variants
				.map((v) => v.label)
				.slice()
				.sort();
			const id = `near-duplicate-values:${rawKey}:${sortedLabels.join("|")}`;

			groups.push({
				id,
				section: "near-duplicate-values",
				key: rawKey,
				reason: bestReason,
				variants,
			});
		}
	}

	groups.sort((a, b) => {
		const sumA = a.variants.reduce((acc, v) => acc + v.count, 0);
		const sumB = b.variants.reduce((acc, v) => acc + v.count, 0);
		if (sumB !== sumA) return sumB - sumA;
		return a.key.localeCompare(b.key);
	});

	return filterDismissed(groups, settings);
}

export function detectMixedValueTypes(
	index: VaultIndex,
	settings: DetectorSettings = {}
): MixedTypeGroup[] {
	const groups: MixedTypeGroup[] = [];

	for (const [rawKey, typeMap] of index.types.entries()) {
		if (index.nested.has(rawKey)) continue;

		const nonEmptyTypes: MixedTypeVariant[] = [];
		let emptyCount = 0;
		let emptyExamples: string[] = [];

		for (const [valType, entry] of typeMap.entries()) {
			if (valType === "empty") {
				emptyCount = entry.count;
				emptyExamples = entry.examples.slice();
			} else if (entry.count > 0) {
				nonEmptyTypes.push({
					type: valType,
					count: entry.count,
					examples: entry.examples.slice(),
				});
			}
		}

		if (nonEmptyTypes.length < 2) continue;

		nonEmptyTypes.sort((a, b) => {
			if (b.count !== a.count) return b.count - a.count;
			return a.type.localeCompare(b.type);
		});

		groups.push({
			id: `mixed-types:${rawKey}`,
			section: "mixed-types",
			key: rawKey,
			reason: "type",
			types: nonEmptyTypes,
			emptyCount,
			emptyExamples,
		});
	}

	groups.sort((a, b) => a.key.localeCompare(b.key));
	return filterDismissed(groups, settings);
}

export function detectMixedDateFormats(
	index: VaultIndex,
	settings: DetectorSettings = {}
): MixedDateFormatGroup[] {
	const groups: MixedDateFormatGroup[] = [];

	for (const [rawKey, dfStats] of index.dateFormats.entries()) {
		if (index.nested.has(rawKey)) continue;
		if (dfStats.nonEmptyCount === 0) continue;
		if (dfStats.patterns.size < 2) continue;

		let matchedDateCount = 0;
		const formats: DateFormatVariant[] = [];

		for (const [pattern, entry] of dfStats.patterns.entries()) {
			matchedDateCount += entry.count;
			formats.push({
				pattern,
				count: entry.count,
				exampleRaw: entry.exampleRaw,
				notes: Array.from(entry.paths).sort(),
			});
		}

		if (matchedDateCount / dfStats.nonEmptyCount < 0.6) {
			continue;
		}

		formats.sort((a, b) => {
			if (b.count !== a.count) return b.count - a.count;
			return a.pattern.localeCompare(b.pattern);
		});

		groups.push({
			id: `mixed-dates:${rawKey}`,
			section: "mixed-dates",
			key: rawKey,
			reason: "date format",
			formats,
		});
	}

	groups.sort((a, b) => a.key.localeCompare(b.key));
	return filterDismissed(groups, settings);
}

export function detectRareKeys(
	index: VaultIndex,
	settings: DetectorSettings = {},
	precomputedLookalikes?: LookalikeKeyGroup[]
): RareKeyGroup[] {
	if (index.totalNotes < 20) return [];

	const threshold = settings.rareKeyThreshold ?? 3;

	const allLookalikes =
		precomputedLookalikes ??
		detectLookalikeKeys(index, { ...settings, showDismissed: true });

	const keysInLookalike = new Set<string>();
	for (const group of allLookalikes) {
		for (const variant of group.variants) {
			keysInLookalike.add(variant.label);
		}
	}

	const rareGroups: RareKeyGroup[] = [];

	for (const [rawKey, notePaths] of index.keys.entries()) {
		if (index.nested.has(rawKey)) continue;
		if (keysInLookalike.has(rawKey)) continue;

		const count = notePaths.size;
		if (count > 0 && count <= threshold) {
			rareGroups.push({
				id: `rare-keys:${rawKey}`,
				section: "rare-keys",
				key: rawKey,
				reason: "rare",
				count,
				notes: Array.from(notePaths).sort(),
			});
		}
	}

	rareGroups.sort((a, b) => {
		if (a.count !== b.count) return a.count - b.count;
		return a.key.localeCompare(b.key);
	});

	return filterDismissed(rareGroups, settings);
}

export function lookupPropertyByValue(
	index: VaultIndex,
	query: string,
	contains = false
): LookupResultRow[] {
	const normQuery = normValue(query);
	if (!normQuery) return [];

	const rows: LookupResultRow[] = [];

	for (const [rawKey, normMap] of index.values.entries()) {
		if (index.nested.has(rawKey)) continue;

		const matchedPaths = new Set<string>();
		const matchedSpellings: { raw: string; count: number }[] = [];
		let totalOccurrences = 0;

		for (const [normVal, entry] of normMap.entries()) {
			const isMatch = contains
				? normVal.includes(normQuery)
				: normVal === normQuery;
			if (!isMatch) continue;

			for (const p of entry.paths) {
				matchedPaths.add(p);
			}
			for (const [raw, c] of entry.rawCounts.entries()) {
				totalOccurrences += c;
				matchedSpellings.push({ raw, count: c });
			}
		}

		if (matchedPaths.size > 0) {
			rows.push({
				key: rawKey,
				count: totalOccurrences,
				notes: Array.from(matchedPaths).sort(),
				matchedSpellings,
			});
		}
	}

	rows.sort((a, b) => {
		if (b.count !== a.count) return b.count - a.count;
		return a.key.localeCompare(b.key);
	});

	return rows;
}

function filterDismissed<T extends { id: string }>(
	groups: T[],
	settings: DetectorSettings
): T[] {
	if (settings.showDismissed) return groups;
	if (!settings.dismissedGroups) return groups;
	const dismissed = new Set(settings.dismissedGroups);
	if (dismissed.size === 0) return groups;
	return groups.filter((g) => !dismissed.has(g.id));
}

export function runAllDetectors(
	index: VaultIndex,
	settings: DetectorSettings = {}
): FullReport {
	const allLookalikes = detectLookalikeKeys(index, {
		...settings,
		showDismissed: true,
	});
	const lookalikeKeys = filterDismissed(allLookalikes, settings);
	const nearDuplicateValues = detectNearDuplicateValues(index, settings);
	const mixedTypes = detectMixedValueTypes(index, settings);
	const mixedDateFormats = detectMixedDateFormats(index, settings);
	const rareKeys = detectRareKeys(index, settings, allLookalikes);

	const nestedKeys = Array.from(index.nested.entries())
		.map(([key, paths]) => ({
			key,
			count: paths.size,
			notes: Array.from(paths).sort(),
		}))
		.sort((a, b) => a.key.localeCompare(b.key));

	const totalDriftGroups =
		lookalikeKeys.length +
		nearDuplicateValues.length +
		mixedTypes.length +
		mixedDateFormats.length +
		rareKeys.length;

	return {
		lookalikeKeys,
		nearDuplicateValues,
		mixedTypes,
		mixedDateFormats,
		rareKeys,
		nestedKeys,
		totalDriftGroups,
	};
}
