export type DatePatternName =
	| "ISO date"
	| "ISO datetime"
	| "Slash date"
	| "Dotted date"
	| "Compact"
	| "Written";

export type ValueType =
	| "list"
	| "number"
	| "boolean"
	| "date"
	| "datetime"
	| "wikilink"
	| "text"
	| "empty";

export interface DatePattern {
	name: DatePatternName;
	regex: RegExp;
	isDateTime?: boolean;
}

export const DATE_PATTERNS: readonly DatePattern[] = [
	{
		name: "ISO date",
		regex: /^\d{4}-\d{2}-\d{2}$/,
	},
	{
		name: "ISO datetime",
		regex: /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/,
		isDateTime: true,
	},
	{
		name: "Slash date",
		regex: /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,
	},
	{
		name: "Dotted date",
		regex: /^\d{1,2}\.\d{1,2}\.\d{2,4}$/,
	},
	{
		name: "Compact",
		regex: /^\d{8}$/,
	},
	{
		name: "Written",
		regex: /^(?:[A-Za-z]{3,9} \d{1,2},? \d{4}|\d{1,2} [A-Za-z]{3,9},? \d{4})$/,
	},
];

export function wordKey(raw: string): string {
	return raw
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
		.replace(/[-_.\s]+/g, "-")
		.toLowerCase()
		.replace(/^-+|-+$/g, "");
}

export function normValue(raw: string): string {
	let s = raw.trim();

	if (s.startsWith("[[") && s.endsWith("]]") && s.length >= 4) {
		s = s.slice(2, -2).trim();
	} else if (s.startsWith("#")) {
		s = s.slice(1).trim();
	}

	return s.replace(/\s+/g, " ").toLowerCase();
}

export function sepNormValue(norm: string): string {
	return norm
		.replace(/[-_\s]+/g, " ")
		.trim();
}

export function isPluralPair(a: string, b: string): boolean {
	if (a === b) return false;
	const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];

	if (longer === shorter + "s") return true;
	if (longer === shorter + "es") return true;
	if (shorter.endsWith("y") && longer === shorter.slice(0, -1) + "ies") {
		return true;
	}
	return false;
}

export function damerauLevenshtein(a: string, b: string): number {
	if (a === b) return 0;
	const lenA = a.length;
	const lenB = b.length;
	if (lenA === 0) return lenB;
	if (lenB === 0) return lenA;

	const dp: number[][] = Array.from({ length: lenA + 1 }, () =>
		new Array<number>(lenB + 1).fill(0)
	);

	for (let i = 0; i <= lenA; i++) dp[i][0] = i;
	for (let j = 0; j <= lenB; j++) dp[0][j] = j;

	for (let i = 1; i <= lenA; i++) {
		for (let j = 1; j <= lenB; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			dp[i][j] = Math.min(
				dp[i - 1][j] + 1,
				dp[i][j - 1] + 1,
				dp[i - 1][j - 1] + cost
			);

			if (
				i > 1 &&
				j > 1 &&
				a[i - 1] === b[j - 2] &&
				a[i - 2] === b[j - 1]
			) {
				dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
			}
		}
	}

	return dp[lenA][lenB];
}

function isDigitChar(ch: string): boolean {
	return ch >= "0" && ch <= "9";
}

export function isSpellingDistanceOne(a: string, b: string): boolean {
	if (a.length < 6 || b.length < 6) return false;
	if (Math.abs(a.length - b.length) > 1) return false;
	if (a === b) return false;

	if (damerauLevenshtein(a, b) !== 1) return false;

	if (a.length === b.length) {
		const diffs: number[] = [];
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i]) diffs.push(i);
		}
		if (diffs.length === 1) {
			const idx = diffs[0];
			if (isDigitChar(a[idx]) || isDigitChar(b[idx])) return false;
			return true;
		}
		if (diffs.length === 2) {
			const [i, j] = diffs;
			if (
				isDigitChar(a[i]) ||
				isDigitChar(a[j]) ||
				isDigitChar(b[i]) ||
				isDigitChar(b[j])
			) {
				return false;
			}
			return true;
		}
		return false;
	}

	const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
	let i = 0;
	let j = 0;
	let diffChar = "";
	while (i < shorter.length && j < longer.length) {
		if (shorter[i] !== longer[j]) {
			diffChar = longer[j];
			j++;
		} else {
			i++;
			j++;
		}
	}
	if (!diffChar) {
		diffChar = longer[longer.length - 1];
	}
	return !isDigitChar(diffChar);
}

export function matchDatePattern(raw: string): DatePatternName | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	for (const pattern of DATE_PATTERNS) {
		if (pattern.regex.test(trimmed)) {
			return pattern.name;
		}
	}
	return null;
}

export function classifyValueType(val: unknown): ValueType {
	if (val === null || val === undefined || val === "") {
		return "empty";
	}
	if (Array.isArray(val)) {
		return val.length === 0 ? "empty" : "list";
	}
	if (typeof val === "number") {
		return Number.isNaN(val) ? "empty" : "number";
	}
	if (typeof val === "boolean") {
		return "boolean";
	}
	if (typeof val === "string") {
		const trimmed = val.trim();
		if (trimmed === "") return "empty";
		if (trimmed.startsWith("[[") && trimmed.endsWith("]]") && trimmed.length >= 4) {
			return "wikilink";
		}
		const dateMatch = matchDatePattern(trimmed);
		if (dateMatch === "ISO datetime") {
			return "datetime";
		}
		if (dateMatch !== null) {
			return "date";
		}
		return "text";
	}
	return "text";
}
