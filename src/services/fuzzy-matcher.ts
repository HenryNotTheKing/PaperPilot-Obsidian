import type { PageTextItem } from "./pdf-parser";

export interface MatchSpan {
	beginIndex: number;
	beginOffset: number;
	endIndex: number;
	endOffset: number;
	score: number;
}

// Heavy normalization: NFKD (decomposes ligatures fi/fl/ff), remove soft
// hyphens, strip all non-alphanumeric, collapse whitespace. Used for fuzzy
// matching passes where tolerance is needed.
function norm(s: string): string {
	return s
		.normalize("NFKD")
		.replace(/\u00ad/g, "")        // soft hyphen
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ") // strip punctuation/symbols
		.replace(/\s+/g, " ")
		.trim();
}

// Light normalization: preserves more structure (Greek letters, math operators,
// common symbols) while still handling ligatures and whitespace differences.
// Better for matching text with math formulas and special characters.
function normLight(s: string): string {
	return s
		.normalize("NFKD")
		.replace(/\u00ad/g, "")        // soft hyphen
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

// Compact normalization: same as heavy normalization, but removes all
// whitespace so wrapped DOM text like `typicallyexcel` still matches an LLM
// sentence that contains `typically excel`.
function normCompact(s: string): string {
	return s
		.normalize("NFKD")
		.replace(/\u00ad/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, "");
}

// --- Boyer-Moore-Horspool exact search ---

function buildBadCharTable(needle: string): Map<string, number> {
	const table = new Map<string, number>();
	for (let i = 0; i < needle.length - 1; i++) {
		table.set(needle[i]!, needle.length - 1 - i);
	}
	return table;
}

function bmhSearch(haystack: string, needle: string): number {
	if (needle.length === 0 || needle.length > haystack.length) return -1;
	const table = buildBadCharTable(needle);
	const defaultShift = needle.length;
	let i = needle.length - 1;
	while (i < haystack.length) {
		let j = needle.length - 1;
		let k = i;
		while (j >= 0 && haystack[k] === needle[j]) { k--; j--; }
		if (j < 0) return k + 1;
		i += table.get(haystack[i]!) ?? defaultShift;
	}
	return -1;
}

// --- Trigram Jaccard similarity ---

function trigrams(s: string): Set<string> {
	const out = new Set<string>();
	for (let i = 0; i <= s.length - 3; i++) out.add(s.slice(i, i + 3));
	return out;
}

// Slide a window of `normNeedle.length` chars across `flatNorm` and return the
// position with the best trigram Jaccard score above `minScore`.
function slidingWindowSearch(
	flatNorm: string,
	normNeedle: string,
	minScore: number
): { pos: number; score: number } | null {
	const wLen = normNeedle.length;
	if (wLen < 6 || flatNorm.length < wLen) return null;

	// Precompute needle trigrams once — avoids recomputing on every iteration.
	const ta = trigrams(normNeedle);
	const taSize = ta.size;

	let bestPos = -1;
	let bestScore = minScore - 0.001;

	const limit = flatNorm.length - wLen;
	for (let s = 0; s <= limit; s++) {
		const tb = trigrams(flatNorm.slice(s, s + wLen));
		let inter = 0;
		for (const t of ta) { if (tb.has(t)) inter++; }
		const score = inter / (taSize + tb.size - inter);
		if (score > bestScore) {
			bestScore = score;
			bestPos = s;
			if (score > 0.95) break; // near-exact — stop early
		}
	}

	return bestPos === -1 ? null : { pos: bestPos, score: bestScore };
}

// --- Normalize-to-original position mapping ---

interface NormalizedWithMap {
	text: string;
	charMap: number[];
}

/**
 * Mirrors norm()/normLight() while keeping a per-normalized-character map back
 * to the original string's UTF-16 offset. Needed because PDF++ highlight
 * offsets must address the original rendered text, not the normalized form.
 */
function normWithMap(
	original: string,
	heavy: boolean,
	compactWhitespace = false
): NormalizedWithMap {
	let text = "";
	const charMap: number[] = [];
	let pendingSpace = false;
	let started = false;

	for (let origPos = 0; origPos < original.length; origPos++) {
		let chunk = original[origPos]!
			.normalize("NFKD")
			.replace(/\u00ad/g, "")
			.toLowerCase();
		if (heavy) chunk = chunk.replace(/[^a-z0-9\s]/g, " ");

		for (let i = 0; i < chunk.length; i++) {
			const ch = chunk[i]!;
			if (/\s/.test(ch)) {
				if (compactWhitespace) continue;
				if (!started || pendingSpace) continue;
				pendingSpace = true;
				continue;
			}

			if (pendingSpace) {
				text += " ";
				charMap.push(origPos);
				pendingSpace = false;
			}

			text += ch;
			charMap.push(origPos);
			started = true;
		}
	}

	return { text, charMap };
}

// --- Map flat-string positions back to item indices + within-item offsets ---

function posToSpan(
	flatStart: number,
	flatEnd: number,
	items: PageTextItem[],
	itemStarts: number[],
	score: number,
	normToOrigMaps?: number[][]
): MatchSpan | null {
	let beginArrIdx = 0;
	for (let i = itemStarts.length - 1; i >= 0; i--) {
		if ((itemStarts[i] ?? 0) <= flatStart) { beginArrIdx = i; break; }
	}
	let endArrIdx = itemStarts.length - 1;
	for (let i = beginArrIdx; i < itemStarts.length; i++) {
		const nextStart = itemStarts[i + 1] ?? Infinity;
		if (flatEnd - 1 < nextStart) { endArrIdx = i; break; }
	}
	const beginItem = items[beginArrIdx];
	const endItem = items[endArrIdx];
	if (!beginItem || !endItem) return null;

	const normBeginOffset = flatStart - (itemStarts[beginArrIdx] ?? 0);
	const normEndOffset = flatEnd - (itemStarts[endArrIdx] ?? 0);

	const beginOffset = normToOrigMaps
		? Math.min(
			normBeginOffset >= (normToOrigMaps[beginArrIdx]?.length ?? 0)
				? beginItem.text.length
				: (normToOrigMaps[beginArrIdx]?.[normBeginOffset] ?? beginItem.text.length),
			beginItem.text.length
		)
		: Math.min(normBeginOffset, beginItem.text.length);

	const extendTrailingPunctuation = (text: string, offset: number): number => {
		let nextOffset = offset;
		while (nextOffset < text.length && /[\])}"'’”.,;:!?]/.test(text[nextOffset]!)) {
			nextOffset++;
		}
		return nextOffset;
	};

	const endOffset = normToOrigMaps
		? Math.min(
			extendTrailingPunctuation(
				endItem.text,
				normEndOffset <= 0
				? 0
				: ((normToOrigMaps[endArrIdx]?.[
					Math.min(
						normEndOffset - 1,
						(normToOrigMaps[endArrIdx]?.length ?? 1) - 1
					)
				] ?? (endItem.text.length - 1)) + 1)
			),
			endItem.text.length
		)
		: Math.min(normEndOffset, endItem.text.length);

	return {
		beginIndex: beginItem.index,
		beginOffset,
		endIndex: endItem.index,
		endOffset,
		score,
	};
}

/** Build flat string + item offset map for a given normalization function */
function buildFlat(items: PageTextItem[], normFn: (s: string) => string): { flat: string; starts: number[] } {
	const starts: number[] = [];
	let flat = "";
	for (const item of items) {
		starts.push(flat.length);
		flat += normFn(item.text) + " ";
	}
	return { flat, starts };
}

/**
 * Build flat string + item offset map + per-item norm→orig maps.
 * Use this for normalized passes so posToSpan can convert normalized offsets
 * back to original-text offsets (required by PDF++ highlight API).
 */
function buildFlatWithNormMaps(
	items: PageTextItem[],
	normFn: (s: string) => string
): { flat: string; starts: number[]; normToOrigMaps: number[][] } {
	const starts: number[] = [];
	const normToOrigMaps: number[][] = [];
	let flat = "";
	const heavy = normFn === norm || normFn === normCompact;
	const compactWhitespace = normFn === normCompact;
	for (const item of items) {
		const normalized = normWithMap(item.text, heavy, compactWhitespace);
		starts.push(flat.length);
		normToOrigMaps.push(normalized.charMap);
		flat += normalized.text + (compactWhitespace ? "" : " ");
	}
	return { flat, starts, normToOrigMaps };
}

// --- Public API ---

export function findBestMatch(
	needle: string,
	items: PageTextItem[],
	threshold = 0.55
): MatchSpan | null {
	if (!needle.trim() || items.length === 0) return null;

	// Pass 0a: exact match on original text — offsets are perfectly correct.
	{
		const orig = buildFlat(items, s => s);
		const pos = bmhSearch(orig.flat, needle);
		if (pos !== -1) {
			const span = posToSpan(pos, pos + needle.length, items, orig.starts, 1.0);
			if (span) return span;
		}
	}

	// Pass 0b: case-insensitive on original text. toLowerCase() preserves string
	// length for all Latin/ASCII chars, so offsets remain exact.
	const lowerNeedle = needle.toLowerCase();
	{
		const orig = buildFlat(items, s => s.toLowerCase());
		const pos = bmhSearch(orig.flat, lowerNeedle);
		if (pos !== -1) {
			const span = posToSpan(pos, pos + lowerNeedle.length, items, orig.starts, 1.0);
			if (span) return span;
		}
	}

	// Precompute both normalization levels for the needle.
	// (Done after Pass 0 so short needles with exact matches can still succeed.)
	const lightNeedle = normLight(needle);
	const heavyNeedle = norm(needle);
	if (heavyNeedle.length < 3) return null;

	// Precompute flat strings with per-item norm→orig maps so that posToSpan
	// translates normalized offsets back to original-text positions (PDF++ API).
	const light = buildFlatWithNormMaps(items, normLight);
	const heavy = buildFlatWithNormMaps(items, norm);

	// Pass 1: light-normalized BMH — preserves math symbols, Greek, etc.
	if (lightNeedle.length >= 3) {
		const pos = bmhSearch(light.flat, lightNeedle);
		if (pos !== -1) {
			const span = posToSpan(pos, pos + lightNeedle.length, items, light.starts, 1.0, light.normToOrigMaps);
			if (span) return span;
		}
	}

	// Pass 2: heavy-normalized BMH — handles ligatures, aggressive cleanup
	{
		const pos = bmhSearch(heavy.flat, heavyNeedle);
		if (pos !== -1) {
			const span = posToSpan(pos, pos + heavyNeedle.length, items, heavy.starts, 1.0, heavy.normToOrigMaps);
			if (span) return span;
		}
	}

	// Pass 2b: compact-normalized BMH — handles wrapped DOM text that drops
	// inter-word spaces altogether, e.g. `typicallyexcel`.
	{
		const compactNeedle = normCompact(needle);
		if (compactNeedle.length >= 3) {
			const compact = buildFlatWithNormMaps(items, normCompact);
			const pos = bmhSearch(compact.flat, compactNeedle);
			if (pos !== -1) {
				const span = posToSpan(
					pos,
					pos + compactNeedle.length,
					items,
					compact.starts,
					1.0,
					compact.normToOrigMaps
				);
				if (span) return span;
			}
		}
	}

	// Pass 3: prefix fallback on light text — first 60% of the needle
	{
		const prefixLen = Math.max(6, Math.floor(lightNeedle.length * 0.6));
		const prefix = lightNeedle.slice(0, prefixLen);
		const pos = bmhSearch(light.flat, prefix);
		if (pos !== -1 && 0.85 >= threshold) {
			// Extend match to full needle length for better highlight coverage
			const span = posToSpan(pos, Math.min(pos + lightNeedle.length, light.flat.length), items, light.starts, 0.85, light.normToOrigMaps);
			if (span) return span;
		}
	}

	// Pass 4: prefix fallback on heavy text
	{
		const prefixLen = Math.max(6, Math.floor(heavyNeedle.length * 0.6));
		const prefix = heavyNeedle.slice(0, prefixLen);
		const pos = bmhSearch(heavy.flat, prefix);
		if (pos !== -1 && 0.80 >= threshold) {
			const span = posToSpan(pos, Math.min(pos + heavyNeedle.length, heavy.flat.length), items, heavy.starts, 0.80, heavy.normToOrigMaps);
			if (span) return span;
		}
	}

	// Pass 5: sliding-window trigram Jaccard on heavy-normalized text
	const result = slidingWindowSearch(heavy.flat, heavyNeedle, threshold);
	if (result) {
		const span = posToSpan(result.pos, result.pos + heavyNeedle.length, items, heavy.starts, result.score, heavy.normToOrigMaps);
		if (span) return span;
	}

	return null;
}
