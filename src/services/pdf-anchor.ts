import type { HighlightResult, PdfAnchor } from "../types";
import type { PageData } from "./pdf-parser";
import { findBestMatch } from "./fuzzy-matcher";

/** Minimum match score to include highlight index data; below this only the page link is kept */
const SELECTION_SCORE_THRESHOLD = 0.5;

export function buildAnchors(
	results: HighlightResult[],
	pages: PageData[],
	pdfFileName: string
): PdfAnchor[] {
	return results.map((result) => {
		const page = pages.find((p) => p.pageNum === result.pageNum);
		const items = page?.items ?? [];

		// Try match on the expected page first
		let match = findBestMatch(result.exact_text, items);
		let matchPageNum = result.pageNum;

		// Cross-page fallback: search adjacent pages if no match on current page
		if (!match || match.score < SELECTION_SCORE_THRESHOLD) {
			const neighbors = [result.pageNum - 1, result.pageNum + 1];
			for (const adjNum of neighbors) {
				const adjPage = pages.find((p) => p.pageNum === adjNum);
				if (!adjPage) continue;
				const adjMatch = findBestMatch(result.exact_text, adjPage.items);
				if (adjMatch && adjMatch.score > (match?.score ?? 0)) {
					match = adjMatch;
					matchPageNum = adjNum;
					if (match.score >= 0.9) break; // good enough
				}
			}
		}

		const link = `[[${pdfFileName}#page=${matchPageNum}]]`;
		const hasMatch = match !== null && match.score >= SELECTION_SCORE_THRESHOLD;

		return {
			markdownLink: link,
			exact_text: result.exact_text,
			type: result.type,
			sectionTag: result.sectionTag,
			headingText: result.headingText,
			matchScore: match?.score ?? 0,
			beginIndex: hasMatch && match ? match.beginIndex : undefined,
			beginOffset: hasMatch && match ? match.beginOffset : undefined,
			endIndex: hasMatch && match ? match.endIndex : undefined,
			endOffset: hasMatch && match ? match.endOffset : undefined,
			matchPageNum,
		};
	});
}
