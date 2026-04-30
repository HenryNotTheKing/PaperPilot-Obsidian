import { describe, expect, it } from "vitest";
import {
	chunkMarkdownByHeadings,
	indexMarkdownContentPointers,
	normalizeMarkdownHeading,
} from "../src/services/markdown-section-chunker";

describe("normalizeMarkdownHeading", () => {
	it("removes markdown formatting noise from headings", () => {
		expect(normalizeMarkdownHeading("![Image](x) ## [Method](y)"))
			.toBe("method");
	});
});

describe("chunkMarkdownByHeadings", () => {
	it("splits markdown into structural chunks with heading paths", () => {
		const markdown = [
			"# Title",
			"Intro text.",
			"## Method",
			"Method text.",
			"### Details",
			"Detail text.",
		].join("\n");

		const chunks = chunkMarkdownByHeadings(markdown);
		expect(chunks).toHaveLength(3);
		expect(chunks[0]?.path).toEqual(["Title"]);
		expect(chunks[1]?.path).toEqual(["Title", "Method"]);
		expect(chunks[2]?.path).toEqual(["Title", "Method", "Details"]);
	});

	it("falls back to a single document chunk when headings are absent", () => {
		const chunks = chunkMarkdownByHeadings("Plain content without headings.");
		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.heading).toBe("Document");
	});

	it("indexes stable section, paragraph, formula, and image pointers", () => {
		const markdown = [
			"# Title",
			"Intro paragraph with Figure 1.",
			"",
			"![Figure 1](https://example.com/fig1.png)",
			"",
			"## Method",
			"We define $$E = mc^2$$ and explain it.",
		].join("\n");

		const pointers = indexMarkdownContentPointers(markdown);
		expect(pointers.sections).toHaveLength(2);
		expect(pointers.paragraphs[0]?.sectionPath).toEqual(["Title"]);
		expect(pointers.images[0]?.content).toContain("https://example.com/fig1.png");
		expect(pointers.formulas[0]?.content).toContain("$$E = mc^2$$");
		expect(pointers.formulas[0]?.lineStart).toBeGreaterThanOrEqual(6);
		expect(pointers.sections[0]?.id).toMatch(/^section:/);
	});

	it("filters trivial symbol-only formulas from pointer indexing", () => {
		const markdown = [
			"# Title",
			"$$",
			"K",
			"$$",
			"",
			"$$",
			"z_i = \\frac{\\exp(x_i)}{\\sum_j \\exp(x_j)}",
			"$$",
		].join("\n");

		const pointers = indexMarkdownContentPointers(markdown);
		expect(pointers.formulas).toHaveLength(1);
		expect(pointers.formulas[0]?.content).toContain("z_i = ");
	});
});