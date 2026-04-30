import { describe, it, expect } from "vitest";
import { toS2Id, parsePaperS2 } from "../src/services/openalex-client";

describe("toS2Id", () => {
	it("converts arxiv: prefix to ArXiv:", () => {
		expect(toS2Id("arxiv:2506.15220")).toBe("ArXiv:2506.15220");
	});
	it("converts doi: prefix to DOI:", () => {
		expect(toS2Id("doi:10.1000/xyz")).toBe("DOI:10.1000/xyz");
	});
	it("passes through other IDs unchanged", () => {
		expect(toS2Id("CorpusID:12345")).toBe("CorpusID:12345");
	});
});

describe("parsePaperS2", () => {
	it("parses a full S2 paper", () => {
		const s2Paper = {
			paperId: "abc123",
			title: "Test Paper",
			authors: [{ authorId: "1", name: "John Doe" }],
			year: 2023,
			abstract: "This is an abstract.",
			citationCount: 42,
			openAccessPdf: { url: "https://example.com/paper.pdf" },
			externalIds: { ArXiv: "2301.00001", DOI: "10.1000/test" },
		};
		const paper = parsePaperS2(s2Paper);
		expect(paper.id).toBe("abc123");
		expect(paper.title).toBe("Test Paper");
		expect(paper.authors).toContain("John Doe");
		expect(paper.year).toBe(2023);
		expect(paper.citationCount).toBe(42);
		expect(paper.pdfUrl).toBe("https://example.com/paper.pdf");
		expect(paper.url).toBe("https://example.com/paper.pdf");
	});

	it("falls back to arxiv URL when no pdf", () => {
		const s2Paper = {
			paperId: "abc123",
			title: "Test Paper",
			authors: [],
			year: 2023,
			abstract: null,
			citationCount: 0,
			openAccessPdf: null,
			externalIds: { ArXiv: "2301.00001" },
		};
		const paper = parsePaperS2(s2Paper);
		expect(paper.url).toBe("https://arxiv.org/abs/2301.00001");
		expect(paper.pdfUrl).toBeUndefined();
	});

	it("falls back to doi URL when no pdf or arxiv", () => {
		const s2Paper = {
			paperId: "abc123",
			title: "Test Paper",
			authors: [],
			year: 2023,
			abstract: null,
			citationCount: 0,
			openAccessPdf: null,
			externalIds: { DOI: "10.1000/test" },
		};
		const paper = parsePaperS2(s2Paper);
		expect(paper.url).toBe("https://doi.org/10.1000/test");
	});

	it("falls back to S2 URL when nothing else available", () => {
		const s2Paper = {
			paperId: "abc123",
			title: null,
			authors: [],
			year: null,
			abstract: null,
			citationCount: null,
			openAccessPdf: null,
			externalIds: null,
		};
		const paper = parsePaperS2(s2Paper);
		expect(paper.title).toBe("Untitled");
		expect(paper.abstract).toBe("");
		expect(paper.year).toBe(0);
		expect(paper.citationCount).toBe(0);
		expect(paper.url).toContain("semanticscholar.org/paper/abc123");
	});
});
