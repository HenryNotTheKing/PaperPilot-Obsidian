import { describe, it, expect } from "vitest";
import {
	extractArxivId,
	parseArxivXml,
	buildPdfUrl,
	buildPdfFilePath,
	buildPaperNotePath,
	buildPaperNoteContent,
	renderPaperNoteTemplate,
	sanitizeFileName,
} from "../src/services/arxiv-client";

describe("extractArxivId", () => {
	it("parses abs URL", () => {
		expect(extractArxivId("https://arxiv.org/abs/2303.08774")).toBe("2303.08774");
	});

	it("strips version suffix from abs URL", () => {
		expect(extractArxivId("https://arxiv.org/abs/2303.08774v2")).toBe(
			"2303.08774"
		);
	});

	it("parses pdf URL", () => {
		expect(extractArxivId("https://arxiv.org/pdf/2303.08774")).toBe("2303.08774");
	});

	it("handles bare new-format ID", () => {
		expect(extractArxivId("2303.08774")).toBe("2303.08774");
	});

	it("handles 5-digit post-dot new-format ID", () => {
		expect(extractArxivId("https://arxiv.org/abs/2303.123456")).toBe(
			"2303.123456"
		);
	});

	it("parses old-format category/id URL", () => {
		expect(extractArxivId("https://arxiv.org/abs/cs/0610101")).toBe("cs/0610101");
	});

	it("returns null for non-ArXiv input", () => {
		expect(extractArxivId("not-an-arxiv-url")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(extractArxivId("")).toBeNull();
	});
});

describe("buildPdfUrl", () => {
	it("builds correct URL for new-format ID", () => {
		expect(buildPdfUrl("2303.08774")).toBe("https://arxiv.org/pdf/2303.08774");
	});

	it("builds correct URL for old-format ID", () => {
		expect(buildPdfUrl("cs/0610101")).toBe("https://arxiv.org/pdf/cs/0610101");
	});
});

describe("buildPdfFilePath", () => {
	it("builds a vault path from the attachment folder and paper title", () => {
		expect(
			buildPdfFilePath(
				{ title: "GPT-4 Technical Report" },
				"Papers/PDFs/"
			)
		).toBe("Papers/PDFs/GPT-4 Technical Report.pdf");
	});

	it("reuses the same filename sanitization as downloads", () => {
		expect(
			buildPdfFilePath(
				{ title: "A/B:C*D?E\"F<G>H|I" },
				"Papers/PDFs"
			)
		).toBe("Papers/PDFs/A-B-C-D-E-F-G-H-I.pdf");
	});
});

describe("buildPaperNotePath", () => {
	it("builds a vault note path from the notes folder and paper title", () => {
		expect(
			buildPaperNotePath(
				{ title: "GPT-4 Technical Report" },
				"Papers/Notes/"
			)
		).toBe("Papers/Notes/GPT-4 Technical Report.md");
	});
});

describe("paper note templates", () => {
	const meta = {
		id: "2303.08774",
		title: "GPT-4 Technical Report",
		authors: ["OpenAI", "Second Author"],
		abstract: "We report the development of GPT-4.",
		published: "2023-03-15",
		pdfUrl: "https://arxiv.org/pdf/2303.08774",
	};

	it("renders known placeholders in a custom template", () => {
		expect(
			renderPaperNoteTemplate(
				"# {{title}}\n{{arxiv_id}}\n{{pdf_file}}",
				meta,
				{ name: "GPT-4 Technical Report.pdf" }
			)
		).toBe("# GPT-4 Technical Report\n2303.08774\nGPT-4 Technical Report.pdf");
	});

	it("falls back to the default template when the configured template is blank", () => {
		const content = buildPaperNoteContent(meta, {
			name: "GPT-4 Technical Report.pdf",
		}, "   ");
		expect(content).toContain("arxiv_id: \"2303.08774\"");
		expect(content).toContain("![[GPT-4 Technical Report.pdf]]");
	});
});

describe("parseArxivXml", () => {
	const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2303.08774v1</id>
    <title>GPT-4 Technical Report</title>
    <summary>We report the development of GPT-4, a large multimodal model.</summary>
    <published>2023-03-15T00:00:00Z</published>
    <author><name>OpenAI</name></author>
    <author><name>Second Author</name></author>
    <link title="pdf" href="https://arxiv.org/pdf/2303.08774v1" rel="related" type="application/pdf"/>
  </entry>
</feed>`;

	it("extracts title", () => {
		const meta = parseArxivXml(SAMPLE_XML);
		expect(meta.title).toBe("GPT-4 Technical Report");
	});

	it("extracts abstract", () => {
		const meta = parseArxivXml(SAMPLE_XML);
		expect(meta.abstract).toContain("development of GPT-4");
	});

	it("extracts all authors", () => {
		const meta = parseArxivXml(SAMPLE_XML);
		expect(meta.authors).toEqual(["OpenAI", "Second Author"]);
	});

	it("extracts published date as YYYY-MM-DD", () => {
		const meta = parseArxivXml(SAMPLE_XML);
		expect(meta.published).toBe("2023-03-15");
	});

	it("extracts clean arxiv ID (strips version and URL prefix)", () => {
		const meta = parseArxivXml(SAMPLE_XML);
		expect(meta.id).toBe("2303.08774");
	});

	it("extracts PDF URL from link element", () => {
		const meta = parseArxivXml(SAMPLE_XML);
		expect(meta.pdfUrl).toBe("https://arxiv.org/pdf/2303.08774v1");
	});

	it("throws on malformed XML with no entry", () => {
		expect(() => parseArxivXml("<feed></feed>")).toThrow("No entry found");
	});
});

describe("sanitizeFileName", () => {
	it("replaces Windows illegal chars with dash", () => {
		expect(sanitizeFileName("A/B:C*D?E\"F<G>H|I")).toBe("A-B-C-D-E-F-G-H-I");
	});

	it("replaces # and newlines", () => {
		expect(sanitizeFileName("Foo #1\nBar\rBaz")).toBe("Foo -1-Bar-Baz");
	});

	it("trims and collapses whitespace", () => {
		expect(sanitizeFileName("  Hello   World  ")).toBe("Hello World");
	});

	it("caps at 100 chars", () => {
		const long = "A".repeat(150);
		expect(sanitizeFileName(long)).toBe("A".repeat(100));
	});
});
