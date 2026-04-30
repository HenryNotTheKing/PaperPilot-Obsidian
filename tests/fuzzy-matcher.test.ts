import { describe, expect, it } from "vitest";
import { findBestMatch } from "../src/services/fuzzy-matcher";
import type { PageTextItem } from "../src/services/pdf-parser";

function makeItems(texts: string[]): PageTextItem[] {
	return texts.map((text, i) => ({
		text,
		height: 10,
		pageNum: 1,
		index: i,
		x: i * 50,
		y: 700,
		width: text.length * 6,
		fontName: "g_d0_f1",
	}));
}

describe("findBestMatch — BMH", () => {
	it("returns null for empty needle", () => {
		expect(findBestMatch("", makeItems(["hello"]))).toBeNull();
		expect(findBestMatch("   ", makeItems(["hello"]))).toBeNull();
	});

	it("returns null for empty items array", () => {
		expect(findBestMatch("hello", [])).toBeNull();
	});

	it("exact match within a single item → score 1.0", () => {
		const items = makeItems(["foo bar", "hello world", "baz qux"]);
		const m = findBestMatch("hello world", items);
		expect(m).not.toBeNull();
		expect(m!.score).toBe(1.0);
		expect(m!.beginIndex).toBe(1);
		expect(m!.endIndex).toBe(1);
	});

	it("exact match spanning two items → score 1.0", () => {
		const items = makeItems(["The quick", "brown fox"]);
		const m = findBestMatch("The quick brown fox", items);
		expect(m).not.toBeNull();
		expect(m!.score).toBe(1.0);
		expect(m!.beginIndex).toBe(0);
		expect(m!.endIndex).toBe(1);
	});

	it("case-insensitive normalized exact match → score 1.0", () => {
		const items = makeItems(["THE QUICK", "BROWN FOX"]);
		const m = findBestMatch("the quick brown fox", items);
		expect(m).not.toBeNull();
		expect(m!.score).toBe(1.0);
	});

	it("prefix fallback (60% of needle) → score 0.85", () => {
		const items = makeItems(["hello world foo", "bar baz"]);
		const needle = "hello world foo XXXXXXXX";
		const m = findBestMatch(needle, items);
		expect(m).not.toBeNull();
		expect(m!.score).toBe(0.85);
	});

	it("prefix fallback below threshold → null", () => {
		const items = makeItems(["hello world foo", "bar baz"]);
		const needle = "hello world foo XXXXXXXX";
		const m = findBestMatch(needle, items, 0.9);
		expect(m).toBeNull();
	});

	it("no match → null", () => {
		const items = makeItems(["apple banana", "cherry date"]);
		expect(findBestMatch("xyz 12345 completely unrelated", items)).toBeNull();
	});

	it("beginOffset is 0 when needle starts at item boundary", () => {
		const items = makeItems(["alpha", "beta gamma"]);
		const m = findBestMatch("alpha", items);
		expect(m).not.toBeNull();
		expect(m!.beginIndex).toBe(0);
		expect(m!.beginOffset).toBe(0);
	});

	it("endOffset matches needle end within item", () => {
		const items = makeItems(["hello world"]);
		const m = findBestMatch("hello world", items);
		expect(m).not.toBeNull();
		expect(m!.endIndex).toBe(0);
		expect(m!.endOffset).toBe("hello world".length);
	});

	it("threshold default 0.8 accepts 0.85 prefix match", () => {
		const items = makeItems(["hello world foo", "bar baz"]);
		const needle = "hello world foo XXXXXXXX";
		expect(findBestMatch(needle, items)).not.toBeNull();
	});
});

describe("findBestMatch — offset correctness (PDF++ alignment)", () => {
	// Pass 0a: exact match — offsets must index the original item text directly.
	it("Pass 0a: exact match offset within item is correct", () => {
		// Item 0: "prefix hello world" — needle starts at char 7
		const items = makeItems(["prefix hello world"]);
		const m = findBestMatch("hello world", items);
		expect(m).not.toBeNull();
		expect(m!.beginIndex).toBe(0);
		expect(m!.beginOffset).toBe(7); // "prefix " = 7 chars
		expect(m!.endIndex).toBe(0);
		expect(m!.endOffset).toBe(18); // 7 + "hello world".length
	});

	// Pass 0b: case-insensitive on original text — toLowerCase preserves length,
	// so offsets must still index the ORIGINAL (uppercase) characters correctly.
	it("Pass 0b: case-insensitive match returns original-text offsets", () => {
		// "INTRO " = 6 chars, match starts at 6
		const items = makeItems(["INTRO HELLO WORLD"]);
		const m = findBestMatch("hello world", items);
		expect(m).not.toBeNull();
		expect(m!.beginIndex).toBe(0);
		expect(m!.beginOffset).toBe(6);
		expect(m!.endIndex).toBe(0);
		expect(m!.endOffset).toBe(17); // 6 + 11
	});

	// NFKD ligature: ﬁ (U+FB01) decomposes to "fi" (2 chars).
	// normLight("eﬁcient") = "eficient" (8 chars from 7 original chars).
	// If needle is "eficient" (post-NFKD) and item has "eﬁcient" (original),
	// Pass 0/0b won't find it (length mismatch). Pass 1 (normLight BMH) must
	// return beginOffset that points into the ORIGINAL 7-char string.
	it("Pass 1 (normLight): ligature ﬁ — beginOffset indexes original string", () => {
		// Original item: "use eﬁcient methods" (7 = "use " + "eﬁcient" + " methods")
		// Char layout: u(0)s(1)e(2) (3)e(4)ﬁ(5)c(6)i(7)e(8)n(9)t(10) (11)m(12)...
		const original = "use e\uFB01cient methods";
		const items = makeItems([original]);
		// Needle uses the decomposed form that the LLM would output from NFKD PDF
		const m = findBestMatch("e\uFB01cient methods", items);
		expect(m).not.toBeNull();
		expect(m!.beginIndex).toBe(0);
		// Must point to char 4 in the original string (the 'e' before ﬁ)
		expect(m!.beginOffset).toBe(4);
		// endOffset must not exceed original.length
		expect(m!.endOffset).toBeLessThanOrEqual(original.length);
	});

	// Soft hyphen (U+00AD) is invisible and removed by normLight/norm.
	// Original item: "algo\u00ADrithm" (9 chars), normLight = "algorithm" (8 chars).
	// beginOffset after match must index into original 9-char string.
	it("Pass 1 (normLight): soft-hyphen removal — offsets stay in original range", () => {
		const original = "algo\u00ADrithm based";
		const items = makeItems([original]);
		const m = findBestMatch("algorithm based", items);
		expect(m).not.toBeNull();
		expect(m!.beginIndex).toBe(0);
		expect(m!.beginOffset).toBeGreaterThanOrEqual(0);
		expect(m!.beginOffset).toBeLessThanOrEqual(original.length);
		expect(m!.endOffset).toBeLessThanOrEqual(original.length);
	});

	// Multi-item match: verify beginOffset and endOffset are valid within each
	// respective item's original text.
	it("Pass 0a: multi-item exact match — offsets valid in each item", () => {
		const items = makeItems(["start of text", "continuation here"]);
		const m = findBestMatch("start of text continuation here", items);
		expect(m).not.toBeNull();
		expect(m!.beginIndex).toBe(0);
		expect(m!.beginOffset).toBe(0);
		expect(m!.endIndex).toBe(1);
		expect(m!.endOffset).toBe("continuation here".length);
	});

	// Verify that even when normalization is required (item has ligature, needle
	// is as the LLM would see it), endOffset does not exceed item text length.
	it("normLight match: endOffset never exceeds item text length", () => {
		// ﬀ (U+FB00) = "ff" after NFKD — 1 original char becomes 2 normalized
		const original = "di\uFB00erence in results";
		const items = makeItems([original]);
		const m = findBestMatch("difference in results", items);
		if (m !== null) {
			// If a match was found (pass 0b may catch "difference" directly since
			// the item has ﬀ not "ff", the lowercased item won't match "difference"),
			// endOffset must not overflow
			expect(m.endOffset).toBeLessThanOrEqual(original.length);
			expect(m.beginOffset).toBeLessThanOrEqual(original.length);
		}
	});

	it("heavy-normalized match keeps last original letter in exclusive endOffset", () => {
		const original = "prefix end-to-end pipeline";
		const items = makeItems([original]);
		const m = findBestMatch("end to end pipeline", items);
		expect(m).not.toBeNull();
		expect(m!.beginOffset).toBe(7);
		expect(m!.endOffset).toBe(26);
		expect(original.slice(m!.beginOffset, m!.endOffset)).toBe("end-to-end pipeline");
	});

	it("soft hyphen inside the final word still maps endOffset to the original end", () => {
		const original = "prefix algo\u00ADrithm";
		const items = makeItems([original]);
		const m = findBestMatch("algorithm", items);
		expect(m).not.toBeNull();
		expect(original.slice(m!.beginOffset, m!.endOffset)).toBe("algo\u00ADrithm");
		expect(m!.endOffset).toBe(original.length);
	});

	it("compact-normalized match keeps the final word when wrapped DOM text drops a space", () => {
		const original = "Current video understanding paradigms, which often focus on specific tasks [20, 66, 19], typicallyexcel only on in-domain data.";
		const items = makeItems([original]);
		const m = findBestMatch(
			"Current video understanding paradigms, which often focus on specific tasks [20, 66, 19], typically excel only on in-domain data.",
			items
		);
		expect(m).not.toBeNull();
		expect(m!.beginOffset).toBe(0);
		expect(m!.endOffset).toBe(original.length);
		expect(original.slice(m!.beginOffset, m!.endOffset).endsWith("data.")).toBe(true);
	});
});
