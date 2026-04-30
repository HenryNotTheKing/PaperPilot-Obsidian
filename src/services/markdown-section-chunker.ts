import type { MarkdownContentPointer } from "../types";

export interface MarkdownSectionChunk {
	heading: string;
	level: number;
	path: string[];
	normalizedHeading: string;
	content: string;
	lineStart: number;
	lineEnd: number;
	charStart: number;
	charEnd: number;
}

export interface MarkdownContentPointerIndex {
	sections: MarkdownContentPointer[];
	paragraphs: MarkdownContentPointer[];
	formulas: MarkdownContentPointer[];
	images: MarkdownContentPointer[];
}

interface ContentRange {
	start: number;
	end: number;
	content: string;
}

function stripMarkdownInline(text: string): string {
	return text
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/^\s*#+\s*/, "")
		.replace(/[*_`~]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function normalizeMarkdownHeading(heading: string): string {
	return stripMarkdownInline(heading).toLowerCase();
}

function createLineOffsets(lines: string[]): number[] {
	const offsets: number[] = [];
	let cursor = 0;
	for (const line of lines) {
		offsets.push(cursor);
		cursor += line.length + 1;
	}
	return offsets;
}

function trimLineBounds(lines: string[], startLine: number): {
	lineStart: number;
	lineEnd: number;
} {
	let firstIndex = 0;
	let lastIndex = lines.length - 1;
	while (firstIndex <= lastIndex && !lines[firstIndex]?.trim()) {
		firstIndex += 1;
	}
	while (lastIndex >= firstIndex && !lines[lastIndex]?.trim()) {
		lastIndex -= 1;
	}
	return {
		lineStart: startLine + firstIndex,
		lineEnd: startLine + lastIndex,
	};
}

function collapsePointerExcerpt(content: string): string {
	const collapsed = stripMarkdownInline(content).replace(/\s+/g, " ").trim();
	if (collapsed.length <= 120) return collapsed;
	return `${collapsed.slice(0, 117).trimEnd()}...`;
}

function hashContent(content: string): string {
	let hash = 2166136261;
	for (let index = 0; index < content.length; index += 1) {
		hash ^= content.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildPointer(
	kind: MarkdownContentPointer["kind"],
	ordinal: number,
	sectionPath: string[],
	lineStart: number,
	lineEnd: number,
	charStart: number,
	charEnd: number,
	content: string,
	excerptOverride?: string
): MarkdownContentPointer {
	const normalizedContent = content.trim();
	const contentHash = hashContent(
		`${kind}\n${sectionPath.join(" > ")}\n${normalizedContent}`
	);
	const excerpt = excerptOverride
		? collapsePointerExcerpt(excerptOverride)
		: collapsePointerExcerpt(normalizedContent);
	return {
		id: `${kind}:${ordinal}:${contentHash}`,
		kind,
		ordinal,
		sectionPath,
		excerpt,
		lineStart,
		lineEnd,
		charStart,
		charEnd,
		contentHash,
		content: normalizedContent,
	};
}

function lineNumberFromOffset(baseLine: number, content: string, offset: number): number {
	return baseLine + content.slice(0, offset).split("\n").length - 1;
}

function collectParagraphRanges(content: string): ContentRange[] {
	const ranges: ContentRange[] = [];
	const normalized = content.trim();
	if (!normalized) return ranges;

	const paragraphPattern = /(?:^|\n\n)([\s\S]*?)(?=\n\n|$)/g;
	for (const match of normalized.matchAll(paragraphPattern)) {
		const block = match[1]?.trim();
		if (!block) continue;
		if (/^!\[[^\]]*\]\([^)]*\)$/.test(block)) continue;
		if (/^\$\$[\s\S]*\$\$$/.test(block)) continue;
		const start = (match.index ?? 0) + (match[0].startsWith("\n\n") ? 2 : 0);
		const blockIndex = normalized.indexOf(block, start);
		ranges.push({
			start: blockIndex,
			end: blockIndex + block.length,
			content: block,
		});
	}

	return ranges;
}

function collectFormulaRanges(content: string): ContentRange[] {
	const ranges: ContentRange[] = [];
	const occupied: Array<[number, number]> = [];
	const blockPatterns = [
		/\$\$[\s\S]+?\$\$/g,
		/\\\[[\s\S]+?\\\]/g,
		/\\begin\{equation\*?\}[\s\S]+?\\end\{equation\*?\}/g,
	];

	for (const pattern of blockPatterns) {
		for (const match of content.matchAll(pattern)) {
			const formula = match[0]?.trim();
			if (!formula) continue;
			const start = match.index ?? 0;
			const end = start + formula.length;
			occupied.push([start, end]);
			ranges.push({ start, end, content: formula });
		}
	}

	for (const match of content.matchAll(/\$(?!\$)([^$\n]{2,}?)\$/g)) {
		const formula = match[0]?.trim();
		if (!formula) continue;
		const start = match.index ?? 0;
		const end = start + formula.length;
		if (occupied.some(([rangeStart, rangeEnd]) => start >= rangeStart && end <= rangeEnd)) {
			continue;
		}
		ranges.push({ start, end, content: formula });
	}

	return ranges.sort((left, right) => left.start - right.start);
}

function stripFormulaDelimiters(formula: string): string {
	return formula
		.replace(/^\$\$?/, "")
		.replace(/\$\$?$/, "")
		.replace(/^\\\[/, "")
		.replace(/\\\]$/, "")
		.replace(/^\\begin\{equation\*?\}/, "")
		.replace(/\\end\{equation\*?\}$/, "")
		.trim();
}

function isTrivialFormula(formula: string): boolean {
	const inner = stripFormulaDelimiters(formula).replace(/\s+/g, "");
	if (!inner) return true;
	if (inner.length <= 2) return true;
	if (/[=<>+\-*/]/.test(inner)) return false;
	if (/\\(?:frac|sum|prod|operatorname|mathrm|softmax|argmax|argmin)/.test(inner)) {
		return false;
	}
	if (/[()[\]{}]/.test(inner) && inner.length >= 8) return false;
	if (/[\^_]/.test(inner) && inner.length >= 6) return false;
	return /^\\?[A-Za-z]+(?:_[A-Za-z0-9{}]+|\^[A-Za-z0-9{}]+)*$/.test(inner);
}

interface ImageRange extends ContentRange {
	caption: string;
}

function extractCaptionSnippet(text: string): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (!collapsed) return "";
	// First sentence: stop at . ! ? 。 ！ ？ followed by space/end
	const sentenceMatch = collapsed.match(/^(.+?[.!?。！？])(?:\s|$)/);
	const sentence: string = sentenceMatch?.[1] ?? collapsed;
	const sliced: string = sentence.length > 120 ? `${sentence.slice(0, 117).trimEnd()}...` : sentence;
	return sliced.trim();
}

function findCaptionForImage(
	content: string,
	imageStart: number,
	imageEnd: number
): string {
	const altMatch = /!\[([^\]]*)\]/.exec(content.slice(imageStart, imageEnd));
	const alt = altMatch?.[1]?.trim() ?? "";

	// Look at the line right after the image first.
	const after = content.slice(imageEnd).replace(/^\n+/, "");
	const afterPara = after.split(/\n\s*\n/)[0]?.trim() ?? "";
	const afterCaption = extractCaptionSnippet(stripMarkdownInline(afterPara));
	if (
		afterCaption &&
		!/^!\[/.test(afterPara) &&
		(/^(figure|fig\.?|table|图|表)/i.test(afterCaption) || afterCaption.length >= 12)
	) {
		return afterCaption;
	}

	// Otherwise look at the paragraph immediately before.
	const before = content.slice(0, imageStart).replace(/\n+$/, "");
	const beforePara = before.split(/\n\s*\n/).pop()?.trim() ?? "";
	const beforeCaption = extractCaptionSnippet(stripMarkdownInline(beforePara));
	if (beforeCaption && !/^!\[/.test(beforePara) && beforeCaption.length >= 12) {
		return beforeCaption;
	}

	return alt;
}

function collectImageRanges(content: string): ImageRange[] {
	return Array.from(content.matchAll(/!\[[^\]]*\]\([^\s)]+(?:\s+"[^"]*")?\)/g)).map(
		(match) => {
			const imageMarkdown = match[0]?.trim() ?? "";
			const start = match.index ?? 0;
			const end = start + imageMarkdown.length;
			return {
				start,
				end,
				content: imageMarkdown,
				caption: findCaptionForImage(content, start, end),
			};
		}
	);
}

export function chunkMarkdownByHeadings(markdown: string): MarkdownSectionChunk[] {
	const normalized = markdown.replace(/\r\n?/g, "\n").trim();
	if (!normalized) return [];

	const lines = normalized.split("\n");
	const lineOffsets = createLineOffsets(lines);
	const chunks: MarkdownSectionChunk[] = [];
	let currentHeading = "Document";
	let currentLevel = 1;
	let currentPath = [currentHeading];
	let currentLines: string[] = [];
	let currentContentStartLine = 1;
	let currentContentStartChar = 0;

	const flushChunk = () => {
		const rawContent = currentLines.join("\n");
		const content = rawContent.trim();
		if (!content) return;
		const leadingTrim = rawContent.indexOf(content);
		const { lineStart, lineEnd } = trimLineBounds(currentLines, currentContentStartLine);
		chunks.push({
			heading: currentHeading,
			level: currentLevel,
			path: [...currentPath],
			normalizedHeading: normalizeMarkdownHeading(currentHeading),
			content,
			lineStart,
			lineEnd,
			charStart: currentContentStartChar + Math.max(0, leadingTrim),
			charEnd:
				currentContentStartChar + Math.max(0, leadingTrim) + content.length,
		});
	};

	for (const [index, line] of lines.entries()) {
		const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
		if (!headingMatch) {
			currentLines.push(line);
			continue;
		}

		const headingText = stripMarkdownInline(headingMatch[2] ?? "");
		if (!headingText) continue;

		flushChunk();
		currentLevel = headingMatch[1]?.length ?? 1;
		while (currentPath.length >= currentLevel) {
			currentPath.pop();
		}
		currentPath.push(headingText);
		currentHeading = headingText;
		currentLines = [];
		currentContentStartLine = index + 2;
		currentContentStartChar = lineOffsets[index + 1] ?? normalized.length;
	}

	flushChunk();

	if (chunks.length === 0) {
		return [
			{
				heading: "Document",
				level: 1,
				path: ["Document"],
				normalizedHeading: "document",
				content: normalized,
				lineStart: 1,
				lineEnd: lines.length,
				charStart: 0,
				charEnd: normalized.length,
			},
		];
	}

	return chunks;
}

export function indexMarkdownContentPointers(markdown: string): MarkdownContentPointerIndex {
	const chunks = chunkMarkdownByHeadings(markdown);
	const sections = chunks.map((chunk, index) =>
		buildPointer(
			"section",
			index + 1,
			chunk.path,
			chunk.lineStart,
			chunk.lineEnd,
			chunk.charStart,
			chunk.charEnd,
			chunk.content
		)
	);

	const paragraphs: MarkdownContentPointer[] = [];
	const formulas: MarkdownContentPointer[] = [];
	const images: MarkdownContentPointer[] = [];

	for (const chunk of chunks) {
		for (const [index, range] of collectParagraphRanges(chunk.content).entries()) {
			paragraphs.push(
				buildPointer(
					"paragraph",
					paragraphs.length + 1,
					chunk.path,
					lineNumberFromOffset(chunk.lineStart, chunk.content, range.start),
					lineNumberFromOffset(chunk.lineStart, chunk.content, range.end),
					chunk.charStart + range.start,
					chunk.charStart + range.end,
					range.content
				)
			);
		}

		for (const range of collectFormulaRanges(chunk.content)) {
			if (isTrivialFormula(range.content)) continue;
			formulas.push(
				buildPointer(
					"formula",
					formulas.length + 1,
					chunk.path,
					lineNumberFromOffset(chunk.lineStart, chunk.content, range.start),
					lineNumberFromOffset(chunk.lineStart, chunk.content, range.end),
					chunk.charStart + range.start,
					chunk.charStart + range.end,
					range.content
				)
			);
		}

		for (const range of collectImageRanges(chunk.content)) {
			images.push(
				buildPointer(
					"image",
					images.length + 1,
					chunk.path,
					lineNumberFromOffset(chunk.lineStart, chunk.content, range.start),
					lineNumberFromOffset(chunk.lineStart, chunk.content, range.end),
					chunk.charStart + range.start,
					chunk.charStart + range.end,
					range.content,
					range.caption || undefined
				)
			);
		}
	}

	return {
		sections,
		paragraphs,
		formulas,
		images,
	};
}