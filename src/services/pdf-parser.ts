import type { App, TFile } from "obsidian";

let _workerSrc = "";

export function setPdfWorkerSrc(src: string): void {
	_workerSrc = src;
}

export interface PageTextItem {
	text: string;
	height: number;
	pageNum: number;
	index: number;
	x: number;
	y: number;
	width: number;
	fontName: string;
}

export interface FontStyle {
	fontFamily: string;
	vertical: boolean;
}

export interface PageData {
	pageNum: number;
	items: PageTextItem[];
	fullText: string;
	styles: Record<string, FontStyle>;
}

export async function parsePdf(app: App, pdfFile: TFile): Promise<PageData[]> {
	const bytes = await app.vault.readBinary(pdfFile);
	return parsePdfBytes(bytes);
}

export async function parsePdfBytes(bytes: ArrayBuffer): Promise<PageData[]> {
	const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
	pdfjsLib.GlobalWorkerOptions.workerSrc = _workerSrc;

	const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
	const doc = await loadingTask.promise;

	const pages: PageData[] = [];

	for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
		const page = await doc.getPage(pageNum);
		const content = await page.getTextContent({ includeMarkedContent: true });

		// Extract font style info
		const styles: Record<string, FontStyle> = {};
		const rawStyles = (content.styles ?? {}) as Record<string, { fontFamily?: string; vertical?: boolean }>;
		for (const [name, s] of Object.entries(rawStyles)) {
			styles[name] = {
				fontFamily: s.fontFamily ?? "serif",
				vertical: s.vertical ?? false,
			};
		}

		const items: PageTextItem[] = [];
		let fullText = "";
		let prevY: number | null = null;
		let prevHeight: number | null = null;

		content.items.forEach((rawItem: unknown, index: number) => {
			const item = rawItem as {
				str: string;
				height: number;
				hasEOL: boolean;
				transform: number[];
				width: number;
				fontName: string;
			};
			if (!item.str) return;

			const y = item.transform?.[5] ?? 0;
			const h = item.height ?? 0;

			// Detect paragraph breaks: y drops significantly relative to line height
			if (prevY !== null && prevHeight !== null) {
				const yDrop = prevY - y;
				if (yDrop > prevHeight * 1.2) {
					fullText += "\n\n";
				} else if (item.hasEOL) {
					fullText += "\n";
				} else {
					fullText += " ";
				}
			}

			items.push({
				text: item.str,
				height: h,
				pageNum,
				index,
				x: item.transform?.[4] ?? 0,
				y,
				width: item.width ?? 0,
				fontName: item.fontName ?? "",
			});
			fullText += item.str;

			prevY = y;
			prevHeight = h;
		});

		pages.push({ pageNum, items, fullText, styles });
	}

	return pages;
}
