import type { SectionTag, TextChunk } from "../types";
import type { PageData, PageTextItem, FontStyle } from "./pdf-parser";

const MAX_CHUNK_CHARS = 1500;

// Once we see these headings, stop collecting body text
const STOP_PATTERNS = [
	/^\s*\d*\.?\s*references\s*$/i,
	/^\s*\d*\.?\s*appendix\b/i,
	/^\s*\d*\.?\s*acknowledgm/i,
	/^\s*\d+[.:]?\s+references\b/i,
];

// Skip short lines that look like figure/table captions
const CAPTION_PATTERN = /^\s*(figure|fig\.|table|tbl\.)\s*\d+/i;

// Math/symbol font families (case-insensitive substring match)
const MATH_FONT_PATTERNS = [
	"math", "cmmi", "cmsy", "cmex", "cmr", "symbol", "stix",
	"asana", "cambria math", "msbm", "msam", "eufm", "rsfs",
	"lmmath", "latinmodern-math", "xits", "dejavu math",
];

/** Returns true if the font style looks like a mathematical/symbol font. */
function isMathFont(fontName: string, styles: Record<string, FontStyle>): boolean {
	const style = styles[fontName];
	const family = (style?.fontFamily ?? "").toLowerCase();
	const name = fontName.toLowerCase();
	return MATH_FONT_PATTERNS.some((p) => family.includes(p) || name.includes(p));
}

/** Returns true if an item appears to be a standalone formula fragment
 *  (single symbols, subscripts, superscripts, or short math tokens). */
function isFormulaFragment(item: PageTextItem, bodyMedian: number, styles: Record<string, FontStyle>): boolean {
	const t = item.text.trim();
	if (!t) return false;
	// Font-based detection: math/symbol font
	if (isMathFont(item.fontName, styles)) return true;
	// Very short items (≤3 chars) with mathematical symbols
	if (t.length <= 3 && /[∑∏∫∂√≤≥≠≈∈∉⊂⊃∪∩∀∃→←↔⇒⇐⊆⊇±×÷∞∝∇αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ]/.test(t)) return true;
	// Subscript/superscript: much smaller height than body text
	if (item.height > 0 && item.height < bodyMedian * 0.65 && t.length <= 5) return true;
	return false;
}

/** Returns true if an item looks like a table cell (short numeric content in a grid). */
function isTableCell(item: PageTextItem, bodyMedian: number): boolean {
	const t = item.text.trim();
	if (!t || t.length > 20) return false;
	// Primarily numeric content (numbers, %, ±, decimal points)
	const numChars = (t.match(/[\d.%±,\-/]/g) ?? []).length;
	if (numChars / t.length > 0.7 && t.length >= 1) {
		// Only skip if the height roughly matches body text (avoids skipping headings with numbers)
		if (item.height > 0 && item.height <= bodyMedian * 1.1) return true;
	}
	return false;
}

// Map heading text to SectionTag
const SECTION_NAME_MAP: Array<{ pattern: RegExp; tag: SectionTag }> = [
	{ pattern: /^\s*\d*\.?\s*abstract\s*$/i, tag: "abstract" },
	{ pattern: /^\s*\d*\.?\s*introduction\s*$/i, tag: "introduction" },
	{ pattern: /^\s*\d*\.?\s*(related\s*work|background|literature\s*review)\s*$/i, tag: "related_work" },
	{ pattern: /^\s*\d*\.?\s*(method|approach|methodology|model|framework|proposed)\s*$/i, tag: "method" },
	{ pattern: /^\s*\d*\.?\s*(experiment|evaluation|results|empirical|experimental)\s*$/i, tag: "experiment" },
	{ pattern: /^\s*\d*\.?\s*(conclusion|conclusions|discussion|future\s*work)\s*$/i, tag: "conclusion" },
];

function isStopHeading(text: string): boolean {
	const t = text.trim();
	if (t.length > 120) return false;
	return STOP_PATTERNS.some((p) => p.test(t));
}

function isCaption(text: string): boolean {
	return CAPTION_PATTERN.test(text.trim());
}

function classifyHeading(text: string): SectionTag {
	const t = text.trim();
	for (const { pattern, tag } of SECTION_NAME_MAP) {
		if (pattern.test(t)) return tag;
	}
	return "other";
}

/** Compute median height of non-heading text items (body font size). */
function computeBodyMedian(allItems: PageTextItem[]): number {
	const heights = allItems
		.filter((i) => i.text.trim().length > 0)
		.map((i) => i.height)
		.sort((a, b) => a - b);
	if (heights.length === 0) return 12; // fallback
	const mid = Math.floor(heights.length / 2);
	return heights.length % 2 !== 0
		? heights[mid] ?? 12
		: ((heights[mid - 1] ?? 0) + (heights[mid] ?? 0)) / 2;
}

// Numbered heading patterns common in academic papers (e.g., "1 Introduction", "3.1 Encoder")
const _NUMBERED_HEADING_PATTERN =
	/^\s*(\d+\.?\s+[A-Z]|\d+\.\d+\.?\s+[A-Z]|[IVXLC]+\.?\s+[A-Z])/;

/** An item is a heading if its height is above the body median by enough margin.
 *  Academic papers often use only slightly larger fonts for section headings
 *  (e.g., 12pt vs 10pt body = 1.2x ratio), so we use a moderate threshold. */
function isHeading(item: PageTextItem, bodyMedian: number): boolean {
	const t = item.text.trim();
	// Short text + tall font = likely heading
	if (t.length === 0 || t.length > 120) return false;
	// Strong height signal: clearly larger font
	if (item.height > bodyMedian * 1.35) return true;
	// Moderate height: catch academic paper section headings (typically 1.15–1.3x body)
	// Require short text to avoid false positives from body text with same font
	if (item.height > bodyMedian * 1.15 && t.length < 50) return true;
	return false;
}

/** Find the last sentence-ending position (.!?) in text, for cleaner chunk splits. */
function findSentenceBoundary(text: string): number {
	// Walk backwards to find last sentence-ending punctuation followed by space or end
	for (let i = text.length - 1; i >= Math.floor(text.length * 0.3); i--) {
		const ch = text[i];
		if (ch === "." || ch === "!" || ch === "?") {
			// Avoid splitting on abbreviations like "e.g." or "i.e." or "Fig."
			const before = text.slice(Math.max(0, i - 4), i);
			if (/\b(e\.g|i\.e|vs|al|Fig|Eq|Sec|et|Dr|Mr|Mrs|No|Vol)\s*$/i.test(before)) continue;
			return i + 1;
		}
	}
	return -1; // no good boundary found
}

export function chunkPages(pages: PageData[]): TextChunk[] {
	if (pages.length === 0) return [];

	// Phase A: compute body median for heading detection
	const allItems = pages.flatMap((p) => p.items);
	const bodyMedian = computeBodyMedian(allItems);

	// Phase B: walk items, detect headings & paragraph breaks, produce chunks
	const chunks: TextChunk[] = [];
	let stopped = false;
	let currentText = "";
	let currentPageNum = 1;
	let currentItemStart = 0;
	let currentItemEnd = 0;
	let currentTag: SectionTag = "other";
	let currentHeading: string | undefined = undefined;
	let prevY: number | null = null;

	function flushChunk() {
		const trimmed = currentText.trim();
		if (!trimmed) return;
		chunks.push({
			pageNum: currentPageNum,
			sectionTag: currentTag,
			headingText: currentHeading,
			text: trimmed,
			itemRange: [currentItemStart, currentItemEnd],
		});
		currentText = "";
	}

	/** Flush at sentence boundary when exceeding MAX_CHUNK_CHARS. */
	function flushAtSentenceBoundary() {
		const boundary = findSentenceBoundary(currentText);
		if (boundary > 0 && boundary < currentText.length) {
			const flushed = currentText.slice(0, boundary).trim();
			const remainder = currentText.slice(boundary).trim();
			if (flushed) {
				chunks.push({
					pageNum: currentPageNum,
					sectionTag: currentTag,
					headingText: currentHeading,
					text: flushed,
					itemRange: [currentItemStart, currentItemEnd],
				});
			}
			currentText = remainder ? remainder + " " : "";
		} else {
			// No good sentence boundary — flush everything
			flushChunk();
		}
	}

	for (const page of pages) {
		if (stopped) break;
		const pageStyles = page.styles;
		for (const item of page.items) {
			if (stopped) break;
			const t = item.text.trim();
			if (!t) continue;

			if (isStopHeading(t)) {
				flushChunk();
				stopped = true;
				break;
			}

			if (isCaption(t)) continue;

			// Skip formula fragments and table cells
			if (isFormulaFragment(item, bodyMedian, pageStyles)) continue;
			if (isTableCell(item, bodyMedian)) continue;

			// Heading detected: flush current chunk, switch section tag
			if (isHeading(item, bodyMedian)) {
				// Merge consecutive heading items on the same line (e.g., "1" + "Introduction")
				const sameLineAsPrevHeading =
					prevY !== null &&
					Math.abs(item.y - prevY) < bodyMedian * 0.3 &&
					currentText === "";
				if (!sameLineAsPrevHeading) {
					flushChunk();
				}
				// Classify based on the accumulated heading text
				const headingRaw: string = sameLineAsPrevHeading
					? (currentHeading ?? "") + " " + t
					: t;
				currentTag = classifyHeading(headingRaw);
				// Clean heading text: strip leading numbering like "3.1 " or "IV. "
				currentHeading = headingRaw.replace(/^\s*(\d+[.):]?\s*)+/, "")
					.replace(/^\s*[IVXLC]+[.):]\s*/i, "")
					.trim() || headingRaw.trim();
				currentPageNum = item.pageNum;
				currentItemStart = item.index;
				currentItemEnd = item.index;
				prevY = item.y;
				continue;
			}

			// Paragraph break: y drops significantly relative to body line height
			if (prevY !== null) {
				const yDrop = prevY - item.y;
				if (yDrop > bodyMedian * 1.2) {
					// Paragraph boundary — flush if chunk is getting large
					if (currentText.length > MAX_CHUNK_CHARS * 0.6) {
						flushAtSentenceBoundary();
					} else {
						currentText += "\n\n";
					}
				}
			}

			if (!currentText) {
				currentPageNum = item.pageNum;
				currentItemStart = item.index;
			}

			currentText += item.text + " ";
			currentItemEnd = item.index;
			prevY = item.y;

			if (currentText.length > MAX_CHUNK_CHARS) {
				flushAtSentenceBoundary();
			}
		}
	}

	flushChunk();
	return chunks;
}

// Kept for backward compatibility with tests
export function detectSectionTag(
	_text: string,
	_height: number,
	_avgBodyHeight: number
): SectionTag | null {
	return null;
}