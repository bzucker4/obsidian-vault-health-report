import {
	classifyValueType,
	matchDatePattern,
	normValue,
	DatePatternName,
	ValueType,
} from "./normalize";

export interface NoteFrontmatterInput {
	path: string;
	frontmatter?: Record<string, unknown> | null;
}

export interface NormalizedValueEntry {
	rawCounts: Map<string, number>;
	rawPaths: Map<string, Set<string>>;
	paths: Set<string>;
}

export interface TypeEntry {
	count: number;
	examples: string[];
}

export interface DatePatternEntry {
	count: number;
	exampleRaw: string;
	paths: Set<string>;
}

export interface DateFormatStats {
	nonEmptyCount: number;
	patterns: Map<DatePatternName, DatePatternEntry>;
}

export interface KeyStringStats {
	totalLength: number;
	totalCount: number;
}

export interface VaultIndex {
	totalNotes: number;
	keys: Map<string, Set<string>>;
	values: Map<string, Map<string, NormalizedValueEntry>>;
	types: Map<string, Map<ValueType, TypeEntry>>;
	nested: Map<string, Set<string>>;
	dateFormats: Map<string, DateFormatStats>;
	stringStats: Map<string, KeyStringStats>;
}

export interface BuildIndexOptions {
	ignoredKeys?: Iterable<string>;
	excludedFolders?: Iterable<string>;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
	return typeof val === "object" && val !== null && !Array.isArray(val);
}

function isInExcludedFolder(path: string, excludedFolders: string[]): boolean {
	if (excludedFolders.length === 0) return false;
	const normPath = path.replace(/\\/g, "/").replace(/^\/+/, "");
	for (const rawFolder of excludedFolders) {
		const folder = rawFolder
			.trim()
			.replace(/\\/g, "/")
			.replace(/^\/+|\/+$/g, "");
		if (!folder) continue;
		if (normPath === folder || normPath.startsWith(folder + "/")) {
			return true;
		}
	}
	return false;
}

export function createEmptyIndex(): VaultIndex {
	return {
		totalNotes: 0,
		keys: new Map(),
		values: new Map(),
		types: new Map(),
		nested: new Map(),
		dateFormats: new Map(),
		stringStats: new Map(),
	};
}

function recordStringValue(
	index: VaultIndex,
	rawKey: string,
	rawVal: string,
	notePath: string
): void {
	const trimmed = rawVal.trim();
	if (trimmed === "") return;

	const norm = normValue(rawVal);
	let keyMap = index.values.get(rawKey);
	if (!keyMap) {
		keyMap = new Map();
		index.values.set(rawKey, keyMap);
	}

	let entry = keyMap.get(norm);
	if (!entry) {
		entry = {
			rawCounts: new Map(),
			rawPaths: new Map(),
			paths: new Set(),
		};
		keyMap.set(norm, entry);
	}

	entry.rawCounts.set(rawVal, (entry.rawCounts.get(rawVal) ?? 0) + 1);
	let rPaths = entry.rawPaths.get(rawVal);
	if (!rPaths) {
		rPaths = new Set();
		entry.rawPaths.set(rawVal, rPaths);
	}
	rPaths.add(notePath);
	entry.paths.add(notePath);

	let stats = index.stringStats.get(rawKey);
	if (!stats) {
		stats = { totalLength: 0, totalCount: 0 };
		index.stringStats.set(rawKey, stats);
	}
	stats.totalLength += rawVal.length;
	stats.totalCount += 1;
}

function recordDateCandidate(
	index: VaultIndex,
	rawKey: string,
	val: unknown,
	notePath: string
): void {
	const vType = classifyValueType(val);
	if (vType === "empty") return;

	let dfStats = index.dateFormats.get(rawKey);
	if (!dfStats) {
		dfStats = {
			nonEmptyCount: 0,
			patterns: new Map(),
		};
		index.dateFormats.set(rawKey, dfStats);
	}

	dfStats.nonEmptyCount += 1;

	if (typeof val === "string") {
		const pattern = matchDatePattern(val);
		if (pattern !== null) {
			let pEntry = dfStats.patterns.get(pattern);
			if (!pEntry) {
				pEntry = {
					count: 0,
					exampleRaw: val.trim(),
					paths: new Set(),
				};
				dfStats.patterns.set(pattern, pEntry);
			}
			pEntry.count += 1;
			pEntry.paths.add(notePath);
		}
	}
}

export function addFileToIndex(
	index: VaultIndex,
	file: NoteFrontmatterInput,
	ignoredSet: Set<string>,
	excludedFolders: string[]
): void {
	if (isInExcludedFolder(file.path, excludedFolders)) {
		return;
	}

	index.totalNotes += 1;

	const fm = file.frontmatter;
	if (!fm) return;

	for (const [rawKey, rawVal] of Object.entries(fm)) {
		if (rawKey === "position" || ignoredSet.has(rawKey)) continue;
		if (isPlainObject(rawVal)) {
			let nestedPaths = index.nested.get(rawKey);
			if (!nestedPaths) {
				nestedPaths = new Set();
				index.nested.set(rawKey, nestedPaths);
			}
			nestedPaths.add(file.path);
		}
	}

	for (const [rawKey, rawVal] of Object.entries(fm)) {
		if (rawKey === "position" || ignoredSet.has(rawKey)) continue;
		if (isPlainObject(rawVal)) continue;

		let keyPaths = index.keys.get(rawKey);
		if (!keyPaths) {
			keyPaths = new Set();
			index.keys.set(rawKey, keyPaths);
		}
		keyPaths.add(file.path);

		const valType = classifyValueType(rawVal);
		let typeMap = index.types.get(rawKey);
		if (!typeMap) {
			typeMap = new Map();
			index.types.set(rawKey, typeMap);
		}
		let typeEntry = typeMap.get(valType);
		if (!typeEntry) {
			typeEntry = { count: 0, examples: [] };
			typeMap.set(valType, typeEntry);
		}
		typeEntry.count += 1;
		if (
			typeEntry.examples.length < 3 &&
			!typeEntry.examples.includes(file.path)
		) {
			typeEntry.examples.push(file.path);
		}

		if (Array.isArray(rawVal)) {
			for (const item of rawVal) {
				if (typeof item === "string") {
					recordStringValue(index, rawKey, item, file.path);
				}
				recordDateCandidate(index, rawKey, item, file.path);
			}
		} else {
			if (typeof rawVal === "string") {
				recordStringValue(index, rawKey, rawVal, file.path);
			}
			recordDateCandidate(index, rawKey, rawVal, file.path);
		}
	}
}

export function finalizeIndex(index: VaultIndex): VaultIndex {
	for (const nestedKey of index.nested.keys()) {
		index.keys.delete(nestedKey);
		index.values.delete(nestedKey);
		index.types.delete(nestedKey);
		index.dateFormats.delete(nestedKey);
		index.stringStats.delete(nestedKey);
	}
	return index;
}

export function buildIndex(
	files: Iterable<NoteFrontmatterInput>,
	options: BuildIndexOptions = {}
): VaultIndex {
	const index = createEmptyIndex();
	const ignoredSet = new Set<string>(["position"]);
	if (options.ignoredKeys) {
		for (const k of options.ignoredKeys) {
			const trimmed = k.trim();
			if (trimmed) ignoredSet.add(trimmed);
		}
	}
	const excludedFolders = options.excludedFolders
		? Array.from(options.excludedFolders)
		: [];

	for (const file of files) {
		addFileToIndex(index, file, ignoredSet, excludedFolders);
	}

	return finalizeIndex(index);
}
