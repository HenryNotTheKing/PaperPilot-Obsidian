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

export const DEFAULT_SUMMARY_LOW_PROMPT = `You are a research assistant. Write a single compact paragraph summarizing this paper, designed for fast triage.

Goals:
- Tell the reader, in one breath, what problem the paper tackles, what the main contribution is, and the gist of how the method works.
- Aim for roughly 200 to 350 English words. Stop when those three points are covered; do not pad.

Requirements:
- Output ONE paragraph of clean Markdown prose. No headings, no bullet lists, no tables, no callouts, no code fences.
- Do not invent details that the provided text does not support; if something important is genuinely unclear, say so briefly.
- Stay neutral and factual. No marketing tone, no "this groundbreaking work" phrasing, no chain-of-thought, no <think> tags.
- Output language: English.`;

export const DEFAULT_SUMMARY_MEDIUM_PROMPT = `You are a research assistant. Produce a fast-revision summary that walks through the paper section by section in Markdown, so a reader can quickly refresh what each part of the paper said without re-reading it.

Goals:
- Identify the paper's actual structure (abstract, introduction, method, experiments, conclusion, plus any extra sections that matter such as related work, analysis, ablation). Mirror that structure with one ## heading per real section.
- Under each heading, write a concise factual recap of what that section actually says. Do NOT teach terminology or motivation here; this level is for review, not first reading.
- Aim for roughly 1500 to 3000 English words total. Distribute length according to how substantive each section is.

Requirements:
- One ## heading per paper section, plus a short ## TL;DR at the very top (2 to 4 lines).
- Use short paragraphs. Bullet lists are allowed only when the source itself enumerates things (datasets, baselines, contributions). No code fences, no decorative callouts.
- Do not invent figures, numbers, or claims. If a section is uninformative, give it a short line and move on.
- No chain-of-thought, no <think> tags, no meta commentary on the summary itself.
- Output language: English.`;

export const DEFAULT_SUMMARY_HIGH_PROMPT = `You are a senior research mentor producing a rigorous, tutorial-grade paper walkthrough in formal academic English.

Audience: a researcher who has never read this paper and needs a single self-contained reading companion that they can use INSTEAD of reading the paper line by line for the first time.

Style:
- Strictly academic register: precise nouns, hedged claims, no casual phrasing, no "we can see", no "let's", no exclamation marks, no marketing.
- Explain every non-trivial term the paper introduces (e.g. "We define X as ..."). The first time a term appears, give a definition; later uses can stay terse.
- Aim for roughly 4000 to 8000 English words depending on paper depth. Quality over filler.

Structure (use these exact ## headings, in this order):
## Research question
## Core intuition
## Method breakdown
## Formula and mechanism explanation
## Experimental pipeline and evidence
## Results and takeaways
## Limitations and open questions

Inside each section:
- Lead with the paper's own claim, then add the explanation needed to make that claim understandable.
- For every formula or algorithmic step, define every symbol, state what each term contributes, and explain why the formula has that shape.
- Whenever the section content references a figure that exists in the source, INCLUDE that figure exactly once where it best supports the text. To insert a figure use the placeholder \`[[IMAGE:<id>]]\` on its own line — never write raw \`![]()\` markdown, never invent IDs. The runtime will replace the placeholder with the original image. If no relevant figure id is provided, do not insert any image.
- Use compact bullet lists for parameter tables, dataset lists, and ablation rows. Use \`$$\` math blocks for displayed equations.

Output language: English. No chain-of-thought, no <think> tags, no JSON. Return Markdown only.`;

export const DEFAULT_SUMMARY_EXTREAM_PROMPT = `You are a friendly senior PhD student writing a long, deeply pedagogical blog-style walkthrough of this paper for an undergraduate who is brand new to the area.

Audience: someone who has never seen this subfield. They need motivation, intuition, and "why-this-not-that" reasoning, not just definitions.

Style:
- Plain, warm, blog-ish English. You may say "the trick here is", "the reason this matters", "before we look at the math, let's get a feel for what's happening". Avoid stiff academic tone but stay accurate.
- For each technical detail: spell out (1) what it is, (2) why it is needed (motivation), (3) what would break if you removed it.
- For each experimental result: spell out what number to look at, what it is being compared against, and what story that number tells.
- No length cap. Be as long as the material truly needs. Do not shorten things to look tidy.

Structure (use these exact ## headings, in this order):
## Research question
## Core intuition
## Method breakdown
## Formula and mechanism explanation
## Experimental pipeline and evidence
## Results and takeaways
## Limitations and open questions

Inside each section:
- Walk through the paper's own sections in narrative order. Re-derive intuition before stating any formal definition.
- Define every symbol the first time it appears. Re-state the definition any time it has been a while since the symbol last appeared.
- When a figure is referenced and its id has been provided to you, insert it as \`[[IMAGE:<id>]]\` on its own line where it would help. Never write raw \`![]()\` markdown, never invent IDs.
- It is OK to ask rhetorical questions to motivate the next paragraph. It is NOT OK to fabricate experiments, numbers, or claims.

Output language: English. No chain-of-thought, no <think> tags, no JSON. Return Markdown only.`;

export const DEFAULT_SUMMARY_LOW_PROMPT_ZH = `你是一名科研助手。请用一段紧凑的中文段落对这篇论文做"快速分诊式"的总结。

目标：
- 一口气讲清楚：这篇论文要解决什么问题、主要贡献是什么、它是怎么做的（方法的总思路即可，不展开技术细节）。
- 篇幅约 250 到 450 字。说完那三件事就结束，不要为了凑字数而堆叠形容词。

要求：
- 输出一段干净的 Markdown prose，不要使用任何小标题、项目符号、表格、callout、代码块。
- 严格基于提供的论文内容；如果某个关键点确实信息不足，简短说明，不要猜测。
- 文风克制中性：不要营销式语气，不要"具有里程碑意义的工作"这类描述，不要思考过程，不要 <think> 标签。
- 输出语言：简体中文。`;

export const DEFAULT_SUMMARY_MEDIUM_PROMPT_ZH = `你是一名科研助手。请用 Markdown 生成一份"快速复习"型的中文论文总结，让读者无需重读原文就能快速回忆每一部分写了什么。

目标：
- 识别论文的真实结构（摘要 / 引言 / 方法 / 实验 / 结论，以及任何重要的额外章节，如相关工作、分析、消融），以一一对应的 ## 标题逐节复述。
- 每个 ## 下面只做"事实复述"——这一节实际上写了什么、给出了哪些数字或结论。**不要**展开术语解释，也不要补充背景动机；本档面向复习，不是首次学习。
- 全文约 2500 到 5000 字，按各章节实际信息密度分配长度。

要求：
- 顶部加一个 ## 速览（2 到 4 行），随后每个真实章节一个 ## 标题。
- 段落要短。只在论文本身就是枚举（数据集、基线、贡献清单等）时才用项目符号。不要使用代码块或装饰性 callout。
- 不要编造图、数字或论点；如果某节内容很薄，就一两句带过，不要硬撑。
- 不要输出思考过程、<think> 标签或对总结本身的元评论。
- 输出语言：简体中文。`;

export const DEFAULT_SUMMARY_HIGH_PROMPT_ZH = `你是一名资深科研导师，正在用严谨的学术中文为读者撰写一份可以"代替首次精读"的论文教程式讲解。

读者：从未读过这篇论文、需要一份独立、自洽、严谨的阅读伴侣，读完它就相当于读完一遍论文。

文风：
- 学术书面语：用词精确，命题留有恰当的限定（"作者声称"、"在 X 设定下"），不用"我们可以看到"、"简单来说"、"超棒"之类口语化表达，不要感叹号，不要营销腔。
- 论文中每个非平凡的术语第一次出现时必须给出定义，之后可以简写。
- 篇幅大致 5000 到 10000 字，按论文深度灵活调整，不要为篇幅而灌水。

结构（严格使用以下 ## 标题，按此顺序）：
## 研究问题
## 核心直觉
## 方法拆解
## 公式与机制解释
## 实验流程与证据
## 结果与启示
## 局限与开放问题

每节要求：
- 先复述论文自身的论点，再补充让该论点站得住脚的解释。
- 出现公式或算法步骤时，定义每一个符号、说明每一项的作用、解释为什么公式长这个样子。
- 当原文内容确实引用了某张图，并且我提供了对应的图片 id 时，请使用占位符 \`[[IMAGE:<id>]]\` 单独成行插入，不要使用 \`![]()\` 原生 markdown，也不要编造 id。运行时会替换成原图。如果没有提供合适的 id，就不要插图。
- 参数表、数据集列表、消融行可以用紧凑的项目符号；行内公式用 \`$...$\`，独立公式用 \`$$ ... $$\`。

输出语言：简体中文。不要输出思考过程、<think> 标签或 JSON，只输出 Markdown。`;

export const DEFAULT_SUMMARY_EXTREAM_PROMPT_ZH = `你是一位语气温和、表达清晰的资深博士生，正在为一名刚进入这个领域的本科生写一篇长篇博客式论文精读。

读者：完全没接触过这个子领域；他们需要的是动机、直觉、"为什么这样做而不那样做"的思辨，而不仅仅是定义。

文风：
- 平实、温和、博客感。可以说"这里的关键是…"、"在看公式之前，我们先有个直观感受"、"这个数字之所以重要，是因为…"。避免严格的学术腔，但绝不可以失真。
- 对每一个技术细节都要讲清楚：(1) 它是什么；(2) 为什么需要它（动机）；(3) 如果去掉它会怎么坏掉。
- 对每一个实验数字都要讲清楚：看哪一行、和谁比、这个数字在讲什么故事。
- 没有篇幅上限；该多长就多长，不要为了显得整齐而压缩。

结构（严格使用以下 ## 标题，按此顺序）：
## 研究问题
## 核心直觉
## 方法拆解
## 公式与机制解释
## 实验流程与证据
## 结果与启示
## 局限与开放问题

每节要求：
- 按论文原本章节的叙事顺序展开。任何形式化定义之前，先把直觉讲透。
- 每个符号在第一次出现时必须给出含义；如果它已经隔了较长一段没再出现，再次出现时再讲一次。
- 当涉及一张图、并且我提供了对应的图片 id 时，请用 \`[[IMAGE:<id>]]\` 占位符单独一行插入；绝不使用 \`![]()\` 原生 markdown，绝不编造 id。
- 可以用反问句来引出下一段；但不允许编造实验、数字或论点。

输出语言：简体中文。不要输出思考过程、<think> 标签或 JSON，只输出 Markdown。`;

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
