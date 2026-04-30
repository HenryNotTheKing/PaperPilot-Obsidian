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

	it("populates image excerpt with adjacent caption text", () => {
		const markdown = [
			"# Title",
			"Some intro.",
			"",
			"![arch](https://example.com/fig1.png)",
			"",
			"Figure 1: An overview of our system architecture.",
			"",
			"More text after.",
		].join("\n");

		const pointers = indexMarkdownContentPointers(markdown);
		expect(pointers.images).toHaveLength(1);
		const excerpt = pointers.images[0]?.excerpt ?? "";
		expect(excerpt.toLowerCase()).toContain("figure 1");
		expect(excerpt.length).toBeLessThanOrEqual(120);
	});

	it("falls back to alt text when no caption paragraph is adjacent", () => {
		const markdown = [
			"# Title",
			"",
			"![system overview](https://example.com/x.png)",
			"",
		].join("\n");

		const pointers = indexMarkdownContentPointers(markdown);
		const excerpt = pointers.images[0]?.excerpt ?? "";
		expect(excerpt).toContain("system overview");
	});
});