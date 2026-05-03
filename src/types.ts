export type SectionTag =
	| "abstract"
	| "introduction"
	| "related_work"
	| "method"
	| "experiment"
	| "conclusion"
	| "other";

export interface TextChunk {
	pageNum: number;
	sectionTag: SectionTag;
	headingText?: string;
	text: string;
	itemRange: [number, number];
}

export interface HighlightResult {
	exact_text: string;
	type: string;
	pageNum: number;
	sectionTag: SectionTag;
	headingText?: string;
}

export interface PdfAnchor {
	markdownLink: string;
	exact_text: string;
	type: string;
	sectionTag: SectionTag;
	headingText?: string;
	matchScore: number;
	/** Index into the page's textLayer spans for the first matched item */
	beginIndex?: number;
	/** Character offset within the beginIndex span */
	beginOffset?: number;
	/** Index into the page's textLayer spans for the last matched item */
	endIndex?: number;
	/** Character offset within the endIndex span (exclusive) */
	endOffset?: number;
	/** The actual page number where the match was found (may differ from result.pageNum after cross-page fallback) */
	matchPageNum?: number;
}

export interface StoredHighlight {
	exact_text: string;
	type: string;
	pageNum: number;
	/** data-idx of the first textLayer span belonging to this highlight */
	beginIndex: number;
	/** Character offset within the beginIndex span */
	beginOffset: number;
	/** data-idx of the last textLayer span belonging to this highlight */
	endIndex: number;
	/** Character offset within the endIndex span (exclusive) */
	endOffset: number;
}

export type LlmProvider = "auto" | "openai" | "anthropic";

export function normalizeLlmProvider(
	value: unknown,
	fallback: LlmProvider = "auto"
): LlmProvider {
	if (value === "auto" || value === "openai" || value === "anthropic") {
		return value;
	}
	return fallback;
}

export interface LlmConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
	provider?: LlmProvider;
	concurrencyLimit?: number;
}

export interface LlmApiErrorLike extends Error {
	status?: number;
	provider?: LlmProvider;
	requestId?: string;
	errorType?: string;
	rawMessage: string;
	retryAfterMs?: number | null;
	isRetryable: boolean;
	isOverloaded: boolean;
}

export interface LlmOverloadInfo {
	at: number;
	status?: number;
	provider?: LlmProvider;
	requestId?: string;
	errorType?: string;
	message: string;
	retryAfterMs?: number | null;
}

export interface LlmConcurrencySnapshot {
	currentConcurrency: number;
	maxConcurrency: number;
	cooldownUntil: number | null;
	recentOverloadCount: number;
	activeCount: number;
	pendingCount: number;
	lastOverload: LlmOverloadInfo | null;
}

export type SummaryEffort = "low" | "medium" | "high" | "extream";

export function normalizeSummaryEffort(
	value: unknown,
	fallback: SummaryEffort = "medium"
): SummaryEffort {
	if (
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "extream"
	) {
		return value;
	}
	return fallback;
}

export interface ArxivMeta {
	id: string;
	title: string;
	authors: string[];
	abstract: string;
	published: string;
	pdfUrl: string;
}

const DEFAULT_HIGHLIGHT_FALLBACK_COLOR = "#ffd000";
const LEGACY_DEFAULT_TYPE_COLOR_MAP: Record<string, string> = {
	motivation: "#ff5050",
	key_step: "#5078ff",
	contribution: "#3cc864",
};
const LEGACY_TYPE_COLOR_ALIASES: Record<string, string> = {
	red: "#ff3030",
	blue: "#2f63ff",
	green: "#10b84a",
	yellow: DEFAULT_HIGHLIGHT_FALLBACK_COLOR,
};
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const HIGHLIGHT_FILL_ALPHA = 0.84;
export const DEFAULT_TYPE_COLOR_MAP: Record<string, string> = {
	motivation: "#ff3030",
	key_step: "#2f63ff",
	contribution: "#10b84a",
};

function expandHexColor(hexColor: string): string {
	if (hexColor.length === 4) {
		return `#${hexColor[1]}${hexColor[1]}${hexColor[2]}${hexColor[2]}${hexColor[3]}${hexColor[3]}`.toLowerCase();
	}
	return hexColor.toLowerCase();
}

export function normalizeHighlightColor(
	colorValue: string | undefined,
	fallbackColor: string = DEFAULT_HIGHLIGHT_FALLBACK_COLOR
): string {
	const trimmed = colorValue?.trim();
	if (!trimmed) return expandHexColor(fallbackColor);

	const legacyColor = LEGACY_TYPE_COLOR_ALIASES[trimmed.toLowerCase()];
	if (legacyColor) return legacyColor;

	if (HEX_COLOR_RE.test(trimmed)) {
		return expandHexColor(trimmed);
	}

	return expandHexColor(fallbackColor);
}

export function normalizeTypeColorMap(
	typeColorMap?: Record<string, string>
): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const type in DEFAULT_TYPE_COLOR_MAP) {
		if (!Object.prototype.hasOwnProperty.call(DEFAULT_TYPE_COLOR_MAP, type)) continue;
		const fallbackColor =
			DEFAULT_TYPE_COLOR_MAP[type] ?? DEFAULT_HIGHLIGHT_FALLBACK_COLOR;
		const legacyDefaultColor = LEGACY_DEFAULT_TYPE_COLOR_MAP[type] ?? fallbackColor;
		const normalizedColor = normalizeHighlightColor(
			typeColorMap?.[type],
			fallbackColor
		);
		normalized[type] =
			normalizedColor === legacyDefaultColor
				? fallbackColor
				: normalizedColor;
	}
	return normalized;
}

export function toHighlightFillColor(
	baseColor: string,
	alpha: number = HIGHLIGHT_FILL_ALPHA
): string {
	const normalized = normalizeHighlightColor(baseColor);
	const red = parseInt(normalized.slice(1, 3), 16);
	const green = parseInt(normalized.slice(3, 5), 16);
	const blue = parseInt(normalized.slice(5, 7), 16);
	const clampedAlpha = Math.min(1, Math.max(0.15, alpha));
	return `rgba(${red}, ${green}, ${blue}, ${clampedAlpha})`;
}

export interface QueueItem {
	id: string;
	noteFile?: string;
	pdfFile: string;
	status: "pending" | "running" | "done" | "error";
	addedAt: number;
	startedAt?: number;
	error?: string;
	progress?: { done: number; total: number };
}

export interface SummaryQueueProgress {
	phase: string;
	message: string;
	done: number;
	total: number;
	activeWorkers?: number;
	pendingWorkers?: number;
	currentPointerLabel?: string;
}

export interface SummaryQueueItem {
	id: string;
	noteFile?: string;
	pdfFile: string;
	effort: SummaryEffort;
	status: "pending" | "running" | "done" | "error";
	addedAt: number;
	startedAt?: number;
	error?: string;
	progress?: SummaryQueueProgress;
}

export type MarkdownPointerKind = "section" | "paragraph" | "formula" | "image";

export interface MarkdownContentPointer {
	id: string;
	kind: MarkdownPointerKind;
	ordinal: number;
	sectionPath: string[];
	excerpt: string;
	lineStart: number;
	lineEnd: number;
	charStart: number;
	charEnd: number;
	contentHash: string;
	content: string;
}

export type HighEffortSourceKind =
	| "huggingface-markdown"
	| "arxiv-html"
	| "ar5iv-html"
	| "jina-reader"
	| "pdf";

export interface HighEffortSourceAttempt {
	kind: HighEffortSourceKind;
	label: string;
	status: "success" | "error" | "skipped";
	reason?: string;
}

export interface HighEffortSourceBundle {
	paperTitle: string;
	markdown: string;
	sourceKind: HighEffortSourceKind;
	sourceLabel: string;
	attempts: HighEffortSourceAttempt[];
	sectionPointers: MarkdownContentPointer[];
	paragraphPointers: MarkdownContentPointer[];
	formulaPointers: MarkdownContentPointer[];
	imagePointers: MarkdownContentPointer[];
}

export type HighEffortTutorialHeadingKey =
	| "research_question"
	| "core_intuition"
	| "method_breakdown"
	| "formula_mechanism"
	| "experimental_pipeline"
	| "results_takeaways"
	| "limitations_open_questions";

export interface HighEffortSectionPlan {
	pointerId: string;
	targetHeading: HighEffortTutorialHeadingKey;
	goal: string;
}

export interface HighEffortImagePlan {
	pointerId: string;
	targetHeading: HighEffortTutorialHeadingKey;
	reason: string;
}

export interface HighEffortPlannerResult {
	tutorialTitle: string;
	sectionPlans: HighEffortSectionPlan[];
	formulaPointerIds: string[];
	imagePlans: HighEffortImagePlan[];
	narrativeFocus: string[];
}

export interface HighEffortExplainerOutput {
	pointerId: string;
	targetHeading: HighEffortTutorialHeadingKey;
	markdown: string;
	imagePointerIds: string[];
	figureMentions?: string[];
	figureNote?: string;
}

export interface HighEffortRevisionRequest {
	pointerIds: string[];
	targetHeading: HighEffortTutorialHeadingKey;
	issue: string;
	instruction: string;
}

export interface PaperMeta {
	id: string;
	title: string;
	authors: string[];
	year: number;
	abstract: string;
	citationCount: number;
	url: string;
	pdfUrl?: string;
}

export type PaperIdType = "arxiv" | "doi";

export interface CitationCard {
	paper: PaperMeta;
	similarityScore: number;
	influenceScore: number;
	finalScore: number;
	expanded: boolean;
}

export const DEFAULT_ARXIV_FIELD_ALIASES = ["arxiv_id", "arxiv"];
export const DEFAULT_DOI_FIELD_ALIASES = ["doi"];

export function normalizeCitationFieldAliases(
	fieldAliases: unknown,
	fallback: string[]
): string[] {
	const source = Array.isArray(fieldAliases) ? fieldAliases : fallback;
	const normalized: string[] = [];
	const seen = new Set<string>();

	for (const alias of source) {
		if (typeof alias !== "string") continue;
		const trimmed = alias.trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		normalized.push(trimmed);
	}

	return normalized.length > 0 ? normalized : [...fallback];
}

export interface CitationSidebarSettings {
	enabled: boolean;
	maxResults: number;
	minSimilarity: number;
	semanticScholarApiKey: string;
	arxivFieldAliases: string[];
	doiFieldAliases: string[];
}

// ─── Citation Export ─────────────────────────────────────────────────────────

export type CitationBibEntryType = "article" | "inproceedings" | "misc";

/** Resolved citation data for a single paper, ready for formatting. */
export interface CitationRecord {
	title: string;
	authors: string[];
	year: number;
	arxivId?: string;
	doi?: string;
	/** Conference / journal name (from frontmatter venue/journal/booktitle) */
	venue?: string;
	entryType?: CitationBibEntryType;
	url?: string;
	/** Frontmatter fields that were missing and could not be resolved */
	missingFields: string[];
}

export type CitationFormat = "bibtex" | "ieee";
export type CitationExportFormat = CitationFormat | `custom:${string}`;

export interface CitationCustomFormat {
	name: string;
	/** Template with placeholders: {title} {authors} {year} {doi} {arxiv_id} {url} {venue} */
	template: string;
}

export interface CitationExportSettings {
	defaultFormat: CitationExportFormat;
	customFormats: CitationCustomFormat[];
}

declare module "obsidian" {
	interface Workspace {
		on(
			name: "paper-analyzer:queue-update",
			callback: () => void
		): import("obsidian").EventRef;
		trigger(name: "paper-analyzer:queue-update"): void;
		on(
			name: "citation-sidebar:state-change",
			callback: () => void
		): import("obsidian").EventRef;
		trigger(name: "citation-sidebar:state-change"): void;
	}
}
