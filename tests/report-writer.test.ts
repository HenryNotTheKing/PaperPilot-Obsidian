import { describe, it, expect } from "vitest";
import { renderReport } from "../src/services/report-writer";
import type { PdfAnchor } from "../src/types";

const makeAnchor = (
	type: string,
	section: PdfAnchor["sectionTag"],
	text: string,
	link: string
): PdfAnchor => ({
	exact_text: text,
	type,
	sectionTag: section,
	markdownLink: link,
	matchScore: 0.9,
});

describe("renderReport", () => {
	it("returns empty string for empty anchors array", () => {
		expect(renderReport([])).toBe("");
	});

	it("includes section heading for present sections", () => {
		const anchors = [
			makeAnchor("motivation", "abstract", "example text", "[[p.pdf#page=1]]"),
		];
		const output = renderReport(anchors);
		expect(output).toContain("### Abstract");
		expect(output).toContain("**[motivation]**");
		expect(output).toContain("[[p.pdf#page=1]]");
	});

	it("omits sections with no anchors", () => {
		const anchors = [
			makeAnchor("algorithm", "method", "key step", "[[p.pdf#page=3]]"),
		];
		const output = renderReport(anchors);
		expect(output).not.toContain("### Abstract");
		expect(output).toContain("### Method");
	});

	it("orders sections correctly (abstract before experiment)", () => {
		const anchors = [
			makeAnchor("result", "experiment", "result text", "[[p.pdf#page=5]]"),
			makeAnchor("motivation", "abstract", "background text", "[[p.pdf#page=1]]"),
		];
		const output = renderReport(anchors);
		const absIdx = output.indexOf("### Abstract");
		const expIdx = output.indexOf("### Experiment");
		expect(absIdx).toBeLessThan(expIdx);
	});

	it("starts with separator and section heading", () => {
		const anchors = [
			makeAnchor("contribution", "conclusion", "final result", "[[p.pdf#page=8]]"),
		];
		const output = renderReport(anchors);
		expect(output).toContain("---");
		expect(output).toContain("## AI 精读报告");
	});
});
