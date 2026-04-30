import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import type { CitationSidebarSettings } from "../src/types";
import {
	extractDoi,
	isCitationGraphFile,
	resolvePaperContext,
} from "../src/services/paper-identity-resolver";
import { parsePdf } from "../src/services/pdf-parser";

vi.mock("../src/services/pdf-parser", () => ({
	parsePdf: vi.fn(),
}));

function makeFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.split("/").pop() ?? path;
	const dotIndex = file.name.lastIndexOf(".");
	file.basename = dotIndex >= 0 ? file.name.slice(0, dotIndex) : file.name;
	file.extension = dotIndex >= 0 ? file.name.slice(dotIndex + 1) : "";
	return file;
}

function makeCitationSettings(
	overrides: Partial<CitationSidebarSettings> = {}
): CitationSidebarSettings {
	return {
		enabled: true,
		maxResults: 20,
		minSimilarity: 0.05,
		semanticScholarApiKey: "",
		arxivFieldAliases: ["arxiv_id", "arxiv"],
		doiFieldAliases: ["doi"],
		...overrides,
	};
}

function makeApp(options: {
	markdownFiles?: TFile[];
	frontmatter?: Record<string, Record<string, unknown>>;
	bodies?: Record<string, string>;
} = {}): App {
	const { markdownFiles = [], frontmatter = {}, bodies = {} } = options;
	return {
		metadataCache: {
			getFileCache: (file: TFile) => {
				const fm = frontmatter[file.path];
				return fm ? { frontmatter: fm } : null;
			},
		},
		vault: {
			getMarkdownFiles: () => markdownFiles,
			read: vi.fn(async (file: TFile) => bodies[file.path] ?? ""),
		},
	} as unknown as App;
}

describe("paper-identity-resolver", () => {
	const parsePdfMock = vi.mocked(parsePdf);

	beforeEach(() => {
		parsePdfMock.mockReset();
	});

	it("detects custom arXiv frontmatter aliases in markdown notes", async () => {
		const note = makeFile("Papers/Notes/Test Paper.md");
		const app = makeApp({
			frontmatter: {
				[note.path]: {
					arXiv: "https://arxiv.org/abs/2303.08774v2",
					title: "Test Paper",
					abstract: "Benchmark abstract",
				},
			},
		});

		const context = await resolvePaperContext(app, note, {
			notesFolderPath: "Papers/Notes",
			citationSidebar: makeCitationSettings({ arxivFieldAliases: ["arXiv"] }),
		});

		expect(context?.paperId.type).toBe("arxiv");
		expect(context?.paperId.id).toBe("2303.08774");
		expect(context?.paperId.matchedField).toBe("arXiv");
		expect(context?.queryText).toContain("Test Paper");
	});

	it("resolves pdfs through a uniquely matched local note before parsing the pdf", async () => {
		const pdf = makeFile("Papers/PDFs/Linked Paper.pdf");
		const note = makeFile("Papers/Notes/Linked Paper.md");
		const app = makeApp({
			markdownFiles: [note],
			frontmatter: {
				[note.path]: {
					pdf_file: "Linked Paper.pdf",
					arxiv: "2301.00001",
					title: "Linked Paper",
					abstract: "Linked note abstract",
				},
			},
		});

		const context = await resolvePaperContext(app, pdf, {
			notesFolderPath: "Papers/Notes",
			citationSidebar: makeCitationSettings(),
		});

		expect(context?.resolutionSource).toBe("linked-note");
		expect(context?.paperId.type).toBe("arxiv");
		expect(context?.paperId.id).toBe("2301.00001");
		expect(context?.relatedNote?.path).toBe(note.path);
		expect(parsePdfMock).not.toHaveBeenCalled();
	});

	it("falls back to extracting a DOI from pdf text when no linked note is found", async () => {
		const pdf = makeFile("Papers/PDFs/Fallback Paper.pdf");
		parsePdfMock.mockResolvedValue([
			{
				pageNum: 1,
				items: [],
				fullText: "Fallback Paper DOI: 10.1145/1234567.8901234",
				styles: {},
			},
		]);
		const app = makeApp();

		const context = await resolvePaperContext(app, pdf, {
			notesFolderPath: "Papers/Notes",
			citationSidebar: makeCitationSettings(),
		});

		expect(context?.resolutionSource).toBe("pdf-text");
		expect(context?.paperId.type).toBe("doi");
		expect(context?.paperId.id).toBe("10.1145/1234567.8901234");
		expect(context?.queryText).toContain("Fallback Paper");
	});

	it("extracts DOI values from direct DOI URLs", () => {
		expect(extractDoi("https://doi.org/10.1000/xyz-123")).toBe("10.1000/xyz-123");
	});

	it("marks only markdown and pdf files as citation-graph eligible", () => {
		expect(isCitationGraphFile(makeFile("Papers/Notes/Test.md"))).toBe(true);
		expect(isCitationGraphFile(makeFile("Papers/PDFs/Test.pdf"))).toBe(true);
		expect(isCitationGraphFile(makeFile("Papers/data.json"))).toBe(false);
	});
});