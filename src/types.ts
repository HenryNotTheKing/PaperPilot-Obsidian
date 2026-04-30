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

export const DEFAULT_EXTRACTION_PROMPT = `You are a research analyst. Scan the given academic paper section and mark important sentences.
Return JSON only.

RULE 1: For each important sentence, output:
  - "exact_text": copy the COMPLETE sentence verbatim from the input. It MUST start from the beginning of the sentence and end at a sentence-ending punctuation (period, question mark, or exclamation mark). Never truncate mid-sentence. If a sentence spans multiple lines, include the full sentence.
  - "type": classify as one of
      "motivation" — research background, problem statement, limitation, gap
      "key_step"   — algorithm, formula, design choice, experimental setup
      "contribution" — claimed result, performance number, ablation, conclusion
RULE 2: Extract 2–5 highlights per section. Return {"highlights": []} if nothing relevant.
RULE 3: Never invent information. Copy text exactly as it appears — do not paraphrase or fix typos.
RULE 4: Do NOT output partial sentences, fragments, or text that starts mid-sentence.
RULE 5: Do not output chain-of-thought, explanations, or <think> tags. Return the final JSON immediately.
Return JSON: {"highlights": [{"exact_text": "...", "type": "motivation|key_step|contribution"}]}`;

export const DEFAULT_SUMMARY_LOW_PROMPT = `You are a research assistant. Summarize the paper in one compact paragraph.

Requirements:
- Focus on the paper's problem, core idea, strongest result, and why it matters.
- Stay faithful to the provided paper content. If evidence is missing, say so briefly instead of guessing.
- Maintain a formal written tone. Avoid conversational fillers or casual phrasing.
- Do not use bullets or section headers.
- Do not include chain-of-thought, <think> tags, or step-by-step reasoning. Write the final answer directly.
- Keep the result within 5 to 10 sentences of clear Markdown prose.
- Output language: English.`;

export const DEFAULT_SUMMARY_MEDIUM_PROMPT = `You are a research assistant. Produce a structured paper summary in Markdown.

Use exactly these sections:
## Abstract summary
## Motivation
## Method
## Experimental results
## Contributions

Requirements:
- Explain each section concretely instead of lightly paraphrasing the title or abstract.
- Mention important assumptions, datasets, baselines, or metrics when they are available.
- If a detail is not supported by the provided content, explicitly mark it as unclear instead of inventing it.
- Keep the prose formal and compact; avoid chatty transitions and casual commentary.
- Use Markdown intentionally. Short paragraphs are preferred; when structure helps, you may use concise bullet lists, tables, or a selective Obsidian callout such as > [!note] or > [!tip].
- Do not include chain-of-thought, <think> tags, or step-by-step reasoning. Write the final answer directly.
- Keep the summary concise but information-dense.
- Output language: English.`;

export const DEFAULT_SUMMARY_HIGH_PROMPT = `You are a research assistant. Produce a deep tutorial-style explanation of the paper in Markdown.

Use these sections:
## Research question
## Core intuition
## Method breakdown
## Formula and mechanism explanation
## Experimental pipeline and evidence
## Results and takeaways
## Limitations and open questions

Requirements:
- Explain formulas, symbols, and algorithmic steps in plain language.
- When a formula appears, explain what the important variables mean and why the formula matters.
- Separate what the paper explicitly claims from your interpretation.
- If technical details are missing from the provided content, state that clearly instead of filling gaps with guesses.
- Maintain a formal tutorial-note tone rather than a conversational one.
- Use Markdown to improve readability: short paragraphs, numbered steps, compact lists, and selective Obsidian callouts such as > [!note], > [!tip], > [!example], or > [!warning]. Use ==highlight== only when it genuinely helps emphasis.
- Do not include chain-of-thought, <think> tags, or step-by-step reasoning. Write the final answer directly.
- Output language: English.`;

export const DEFAULT_SUMMARY_EXTREAM_PROMPT = `You are a research assistant. Produce the most exhaustive tutorial-style explanation of the paper in Markdown.

Use these sections:
## Research question
## Core intuition
## Method breakdown
## Formula and mechanism explanation
## Experimental pipeline and evidence
## Results and takeaways
## Limitations and open questions
## Reimplementation notes

Requirements:
- Explain formulas, symbols, and algorithmic steps in plain language.
- Break complex derivations or procedures into numbered steps when the provided content supports it.
- Clarify what the paper explicitly claims, what evidence is shown, and what remains uncertain.
- If technical details are missing from the provided content, state that clearly instead of filling gaps with guesses.
- Maintain a formal tutorial-note tone rather than a conversational one.
- Use Markdown to improve readability: short paragraphs, numbered steps, compact lists, tables when useful, and selective Obsidian callouts such as > [!note], > [!tip], > [!example], or > [!warning]. Use ==highlight== only when it genuinely helps emphasis.
- Do not include chain-of-thought, <think> tags, or step-by-step reasoning. Write the final answer directly.
- Output language: English.`;

export const DEFAULT_SUMMARY_LOW_PROMPT_ZH = `你是一名科研助手。请用一段紧凑的中文总结这篇论文。

要求：
- 聚焦论文试图解决的问题、核心方法、最强结果以及它为什么重要。
- 严格依据提供的论文内容；如果证据不足，请明确说明，不要猜测。
- 文风保持书面、凝练，避免口语化表达。
- 不要使用项目符号或小标题。
- 不要输出思考过程、<think> 标签或逐步推理，直接给出最终答案。
- 用清晰的 Markdown prose 输出 5 到 10 句简体中文。`;

export const DEFAULT_SUMMARY_MEDIUM_PROMPT_ZH = `你是一名科研助手。请用 Markdown 生成结构化的中文论文总结。

严格使用以下章节：
## 摘要总结
## 研究动机
## 方法
## 实验结果
## 贡献

要求：
- 每一节都要具体说明内容，不要只是轻微改写标题或摘要。
- 如果论文里给出了重要假设、数据集、基线或指标，请明确写出来。
- 如果某个细节没有被提供的内容支持，请明确标注信息不足，而不是自行补全。
- 保持书面、克制的表达，避免聊天式、口语化转折。
- 合理使用 Markdown 提升可读性：优先短段落；在确有必要时可使用简洁列表、表格，或适量 Obsidian callout，例如 > [!note]、> [!tip]。
- 不要输出思考过程、<think> 标签或逐步推理，直接给出最终答案。
- 保持总结简洁但信息密度高。
- 输出语言：简体中文。`;

export const DEFAULT_SUMMARY_HIGH_PROMPT_ZH = `你是一名科研助手。请用 Markdown 生成面向学习者的深度中文讲解。

使用以下章节：
## 研究问题
## 核心直觉
## 方法拆解
## 公式与机制解释
## 实验流程与证据
## 结果与结论
## 局限与开放问题

要求：
- 用通俗但准确的语言解释公式、符号和算法步骤。
- 当出现公式时，说明关键变量含义以及这条公式为什么重要。
- 区分论文明确声称的内容和你的解释。
- 如果提供的内容缺少技术细节，请明确指出，不要自行脑补。
- 文风保持正式、接近教程讲义，而不是聊天式口吻。
- 多使用有助于阅读的 Markdown 结构，如短段落、编号列表、项目列表，以及适量 Obsidian callout，例如 > [!note]、> [!tip]、> [!example]、> [!warning]；必要时可用 ==重点==。
- 不要输出思考过程、<think> 标签或逐步推理，直接给出最终答案。
- 输出语言：简体中文。`;

export const DEFAULT_SUMMARY_EXTREAM_PROMPT_ZH = `你是一名科研助手。请用 Markdown 生成最细致、最完整的教程式中文讲解。

使用以下章节：
## 研究问题
## 核心直觉
## 方法拆解
## 公式与机制解释
## 实验流程与证据
## 结果与结论
## 局限与开放问题
## 复现提示

要求：
- 用通俗但准确的语言解释公式、符号和算法步骤。
- 当提供的内容足够时，把复杂推导或流程拆成编号步骤讲清楚。
- 区分论文明确声称的内容、正文给出的证据，以及仍然不确定的地方。
- 如果提供的内容缺少技术细节，请明确指出，不要自行脑补。
- 文风保持正式、接近教程讲义，而不是聊天式口吻。
- 多使用有助于阅读的 Markdown 结构，如短段落、编号列表、项目列表、必要时的小表格，以及适量 Obsidian callout，例如 > [!note]、> [!tip]、> [!example]、> [!warning]；必要时可用 ==重点==。
- 不要输出思考过程、<think> 标签或逐步推理，直接给出最终答案。
- 输出语言：简体中文。`;

export type SummaryPromptLocale = "en" | "zh-CN";

export function getDefaultSummaryPrompt(
	locale: SummaryPromptLocale,
	effort: SummaryEffort
): string {
	if (locale === "zh-CN") {
		switch (effort) {
			case "low":
				return DEFAULT_SUMMARY_LOW_PROMPT_ZH;
			case "extream":
				return DEFAULT_SUMMARY_EXTREAM_PROMPT_ZH;
			case "high":
				return DEFAULT_SUMMARY_HIGH_PROMPT_ZH;
			case "medium":
			default:
				return DEFAULT_SUMMARY_MEDIUM_PROMPT_ZH;
		}
	}

	switch (effort) {
		case "low":
			return DEFAULT_SUMMARY_LOW_PROMPT;
		case "extream":
			return DEFAULT_SUMMARY_EXTREAM_PROMPT;
		case "high":
			return DEFAULT_SUMMARY_HIGH_PROMPT;
		case "medium":
		default:
			return DEFAULT_SUMMARY_MEDIUM_PROMPT;
	}
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
