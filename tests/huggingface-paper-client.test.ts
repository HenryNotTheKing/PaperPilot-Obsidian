import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";

vi.mock("obsidian", async () => {
	const actual = await vi.importActual<typeof import("obsidian")>("obsidian");
	return {
		...actual,
		requestUrl: vi.fn(),
	};
});

vi.mock("../src/services/pdf-parser", () => ({
	parsePdf: vi.fn(),
}));

import {
	buildAr5ivUrl,
	buildArxivHtmlUrl,
	buildHighEffortSourceBundle,
	buildHuggingFacePaperMarkdownUrl,
	buildJinaReaderUrl,
	convertHtmlToStructuredMarkdown,
	truncateHuggingFacePaperMarkdown,
} from "../src/services/huggingface-paper-client";
import { parsePdf } from "../src/services/pdf-parser";

const requestUrlMock = vi.mocked(requestUrl);

function createResponse(status: number, text: string) {
	return {
		status,
		text,
		json: {},
		headers: {},
		arrayBuffer: new ArrayBuffer(0),
	};
}

beforeEach(() => {
	requestUrlMock.mockReset();
	vi.mocked(parsePdf).mockReset();
});

describe("buildHuggingFacePaperMarkdownUrl", () => {
	it("builds the markdown URL for an arXiv paper ID", () => {
		expect(buildHuggingFacePaperMarkdownUrl("2604.04184")).toBe(
			"https://huggingface.co/papers/2604.04184.md"
		);
	});
});

describe("truncateHuggingFacePaperMarkdown", () => {
	it("removes image markdown noise before returning content", () => {
		const source = [
			"# Title",
			"",
			"![Image](https://example.com/image.png)",
			"",
			"## Section",
			"Important text.",
		].join("\n");

		const result = truncateHuggingFacePaperMarkdown(source, "low");
		expect(result).not.toContain("![Image]");
		expect(result).toContain("## Section");
	});

	it("truncates long markdown sources by effort", () => {
		const source = `# Title\n\n${"content ".repeat(4000)}`;
		const result = truncateHuggingFacePaperMarkdown(source, "low");
		expect(result.length).toBeLessThan(source.length);
		expect(result).toContain("[Truncated Hugging Face markdown source]");
	});
});

describe("convertHtmlToStructuredMarkdown", () => {
	it("keeps heading, formulas, and image markdown when converting html", () => {
		const html = [
			"<html><body><main>",
			"<h1>Paper Title</h1>",
			"<p>Intro text.</p>",
			"<figure><img src=\"/fig1.png\" alt=\"Figure 1\" /><figcaption>Figure 1 caption</figcaption></figure>",
			"<div class=\"ltx_Math\" alttext=\"\\bm{x} = y + z\"></div>",
			"</main></body></html>",
		].join("");

		const markdown = convertHtmlToStructuredMarkdown(html, "https://arxiv.org/html/2604.04184");
		expect(markdown).toContain("# Paper Title");
		expect(markdown).toContain("![Figure 1](https://arxiv.org/fig1.png)");
		expect(markdown).toContain("$$\n\\boldsymbol{x} = y + z\n$$");
	});
});

describe("buildHighEffortSourceBundle", () => {
	const pdfFile = {
		basename: "AURA",
		path: "Papers/PDFs/AURA.pdf",
	} as never;

	it("keeps remote images and formulas when Hugging Face markdown succeeds", async () => {
		requestUrlMock.mockResolvedValueOnce(
			createResponse(
				200,
				[
					"# AURA",
					"",
					"## Method",
					"We use $$E = mc^2$$ to motivate the design.",
					"",
					"![Figure 1](https://example.com/fig1.png)",
				].join("\n")
			)
		);

		const bundle = await buildHighEffortSourceBundle({
			app: {} as never,
			pdfFile,
			paperTitle: "AURA",
			arxivId: "2604.04184",
			settings: {
				huggingFaceApiKey: "",
				preferHuggingFacePaperMarkdown: true,
			},
		});

		expect(bundle.sourceKind).toBe("huggingface-markdown");
		expect(bundle.markdown).toContain("![Figure 1](https://example.com/fig1.png)");
		expect(bundle.formulaPointers).toHaveLength(1);
		expect(bundle.imagePointers).toHaveLength(1);
		expect(bundle.attempts[0]?.status).toBe("success");
	});

	it("falls back from Hugging Face to ar5iv when earlier sources are unavailable", async () => {
		requestUrlMock
			.mockResolvedValueOnce(createResponse(404, "missing hf"))
			.mockResolvedValueOnce(createResponse(404, "missing arxiv html"))
			.mockResolvedValueOnce(
				createResponse(
					200,
					"<html><body><main><h1>AURA</h1><h2>Method</h2><p>Method text.</p></main></body></html>"
				)
			)
			.mockResolvedValueOnce(createResponse(404, "missing jina"));

		const bundle = await buildHighEffortSourceBundle({
			app: {} as never,
			pdfFile,
			paperTitle: "AURA",
			arxivId: "2604.04184",
			settings: {
				huggingFaceApiKey: "",
				preferHuggingFacePaperMarkdown: true,
			},
		});

		expect(requestUrlMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ url: buildHuggingFacePaperMarkdownUrl("2604.04184") })
		);
		expect(requestUrlMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ url: buildArxivHtmlUrl("2604.04184") })
		);
		expect(requestUrlMock).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({ url: buildAr5ivUrl("2604.04184") })
		);
		expect(requestUrlMock).toHaveBeenNthCalledWith(
			4,
			expect.objectContaining({ url: buildJinaReaderUrl("2604.04184") })
		);
		expect(bundle.sourceKind).toBe("ar5iv-html");
		expect(bundle.attempts.map((attempt) => attempt.status)).toEqual([
			"skipped",
			"skipped",
			"success",
			"skipped",
		]);
	});

	it("falls back to PDF parsing after all remote sources fail", async () => {
		requestUrlMock
			.mockResolvedValueOnce(createResponse(404, "missing hf"))
			.mockResolvedValueOnce(createResponse(404, "missing arxiv html"))
			.mockResolvedValueOnce(createResponse(404, "missing ar5iv"))
			.mockResolvedValueOnce(createResponse(404, "missing jina"));
		vi.mocked(parsePdf).mockResolvedValueOnce([
			{
				pageNum: 1,
				items: [],
				fullText: "Fallback PDF text.",
				styles: {},
			},
		] as never);

		const bundle = await buildHighEffortSourceBundle({
			app: {} as never,
			pdfFile,
			paperTitle: "AURA",
			arxivId: "2604.04184",
			settings: {
				huggingFaceApiKey: "",
				preferHuggingFacePaperMarkdown: true,
			},
		});

		expect(requestUrlMock).toHaveBeenNthCalledWith(
			4,
			expect.objectContaining({ url: buildJinaReaderUrl("2604.04184") })
		);
		expect(bundle.sourceKind).toBe("pdf");
		expect(bundle.markdown).toContain("Fallback PDF text.");
		expect(bundle.attempts.at(-1)?.kind).toBe("pdf");
	});
});