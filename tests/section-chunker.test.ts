import { describe, it, expect } from "vitest";
import { chunkPages } from "../src/services/section-chunker";
import type { PageData } from "../src/services/pdf-parser";

const makePage = (pageNum: number, items: { text: string }[]): PageData => ({
	pageNum,
	items: items.map((it, i) => ({ text: it.text, height: 12, pageNum, index: i, x: 72, y: 700 - i * 14, width: 400, fontName: "g_d0_f1" })),
	fullText: items.map((it) => it.text).join(" "),
	styles: { "g_d0_f1": { fontFamily: "serif", vertical: false } },
});

describe("chunkPages", () => {
	it("returns empty array for empty pages", () => {
		expect(chunkPages([])).toEqual([]);
	});

	it("returns at least one chunk for non-empty pages", () => {
		const pages = [makePage(1, [{ text: "Body text here." }])];
		expect(chunkPages(pages).length).toBeGreaterThan(0);
	});

	it("all chunks default to sectionTag 'other' when no heading is detected", () => {
		const pages = [makePage(1, [{ text: "Some content." }])];
		const chunks = chunkPages(pages);
		expect(chunks.every((c) => c.sectionTag === "other")).toBe(true);
	});

	it("keeps pageNum from source page", () => {
		const pages = [makePage(5, [{ text: "Content." }])];
		expect(chunkPages(pages)[0]?.pageNum).toBe(5);
	});

	it("stops collecting at References heading", () => {
		const pages = [
			makePage(1, [{ text: "Introduction body." }]),
			makePage(2, [{ text: "References" }]),
			makePage(3, [{ text: "Smith et al. 2023." }]),
		];
		const chunks = chunkPages(pages);
		const hasRef = chunks.some((c) => c.text.includes("Smith et al."));
		expect(hasRef).toBe(false);
	});

	it("stops collecting at numbered References heading", () => {
		const pages = [
			makePage(1, [{ text: "Body text." }]),
			makePage(2, [{ text: "7. References" }]),
			makePage(3, [{ text: "After ref." }]),
		];
		const chunks = chunkPages(pages);
		expect(chunks.some((c) => c.text.includes("After ref."))).toBe(false);
	});

	it("skips figure captions", () => {
		const pages = [
			makePage(1, [
				{ text: "Main body." },
				{ text: "Figure 1: Architecture overview." },
				{ text: "More body." },
			]),
		];
		const chunks = chunkPages(pages);
		const combined = chunks.map((c) => c.text).join(" ");
		expect(combined).not.toContain("Figure 1:");
		expect(combined).toContain("Main body.");
		expect(combined).toContain("More body.");
	});

	it("splits content exceeding MAX_CHUNK_CHARS into multiple chunks", () => {
		const manyItems = Array.from({ length: 200 }, (_, i) => ({
			text: `sentence number ${i} here`,
		}));
		const pages = [makePage(1, manyItems)];
		const chunks = chunkPages(pages);
		expect(chunks.length).toBeGreaterThan(1);
	});
});
