import { describe, it, expect, vi } from "vitest";
import { parsePdfBytes } from "../src/services/pdf-parser";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
	GlobalWorkerOptions: { workerSrc: "" },
	getDocument: () => ({
		promise: Promise.resolve({
			numPages: 2,
			getPage: (pageNum: number) =>
				Promise.resolve({
					getTextContent: () =>
						Promise.resolve({
							items: [
								{ str: `Page ${pageNum} text`, height: 12, hasEOL: false, transform: [12, 0, 0, 12, 72, 700], width: 80, fontName: "g_d0_f1" },
								{ str: " more text", height: 12, hasEOL: true, transform: [12, 0, 0, 12, 152, 700], width: 60, fontName: "g_d0_f1" },
							],
							styles: { "g_d0_f1": { fontFamily: "serif", vertical: false } },
						}),
				}),
		}),
	}),
}));

describe("parsePdfBytes", () => {
	it("returns one PageData per page", async () => {
		const pages = await parsePdfBytes(new ArrayBuffer(0));
		expect(pages).toHaveLength(2);
	});

	it("assigns correct pageNum to each page", async () => {
		const pages = await parsePdfBytes(new ArrayBuffer(0));
		expect(pages[0]?.pageNum).toBe(1);
		expect(pages[1]?.pageNum).toBe(2);
	});

	it("extracts text items with height and index", async () => {
		const pages = await parsePdfBytes(new ArrayBuffer(0));
		expect(pages[0]?.items[0]?.text).toBe("Page 1 text");
		expect(pages[0]?.items[0]?.height).toBe(12);
		expect(pages[0]?.items[0]?.index).toBe(0);
	});

	it("builds fullText string per page", async () => {
		const pages = await parsePdfBytes(new ArrayBuffer(0));
		expect(pages[0]?.fullText).toContain("Page 1 text");
		expect(pages[0]?.fullText).toContain("more text");
	});
});
