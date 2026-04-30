import type { App, TFile } from "obsidian";
import type { PaperAnalyzerSettings } from "../settings";
import type {
	HighEffortExplainerOutput,
	HighEffortPlannerResult,
	HighEffortRevisionRequest,
	HighEffortSourceBundle,
	HighEffortTutorialHeadingKey,
	LlmConfig,
	MarkdownContentPointer,
	SummaryQueueProgress,
} from "../types";
import { t } from "../i18n";
import { callLlmText, callLlmTextWithMeta } from "./llm-client";
import { buildHighEffortSourceBundle } from "./huggingface-paper-client";
import { sanitizeMarkdownForObsidian } from "./obsidian-markdown-utils";

interface HighEffortOrchestratorOptions {
	app: App;
	pdfFile: TFile;
	noteFile: TFile;
	arxivId?: string | null;
	settings: PaperAnalyzerSettings;
	config: LlmConfig;
	onProgress?: (progress: SummaryQueueProgress) => void;
	signal?: AbortSignal;
}

interface DraftSection {
	headingKey: HighEffortTutorialHeadingKey;
	blocks: string[];
	images: Array<{ pointerId: string; note: string }>;
}

interface ProgressController {
	done: number;
	total: number;
	report: (progress: Omit<SummaryQueueProgress, "done" | "total">) => void;
	advance: (count?: number) => void;
	addTotal: (count: number) => void;
}

type SummaryStatusPhaseKey =
	| "source"
	| "planning"
	| "sections"
	| "formulas"
	| "merge"
	| "review"
	| "render";

interface SummaryStatusKeyGroup {
	phase: string;
	messages: Record<string, string>;
}

const HEADING_ORDER: HighEffortTutorialHeadingKey[] = [
	"research_question",
	"core_intuition",
	"method_breakdown",
	"formula_mechanism",
	"experimental_pipeline",
	"results_takeaways",
	"limitations_open_questions",
];

const SECTION_STAGE_CONCURRENCY = 4;
const FORMULA_STAGE_CONCURRENCY = 3;
const REVIEW_STAGE_CONCURRENCY = 3;
const MAX_PLANNED_SECTIONS = 10;
const MAX_PLANNED_FORMULAS = 6;
const MAX_REVISION_REQUESTS = 4;
const HIGH_EFFORT_RETRY_MAX_TOKENS = 3200;

const HEADING_COVERAGE_TARGETS: HighEffortTutorialHeadingKey[] = [
	"research_question",
	"core_intuition",
	"method_breakdown",
	"experimental_pipeline",
	"results_takeaways",
	"limitations_open_questions",
];

const TUTORIAL_HEADINGS: Record<
	PaperAnalyzerSettings["language"],
	Record<HighEffortTutorialHeadingKey, string>
> = {
	en: {
		research_question: "Research question",
		core_intuition: "Core intuition",
		method_breakdown: "Method breakdown",
		formula_mechanism: "Formula and mechanism explanation",
		experimental_pipeline: "Experimental pipeline and evidence",
		results_takeaways: "Results and takeaways",
		limitations_open_questions: "Limitations and open questions",
	},
	"zh-CN": {
		research_question: "研究问题",
		core_intuition: "核心直觉",
		method_breakdown: "方法拆解",
		formula_mechanism: "公式与机制解释",
		experimental_pipeline: "实验流程与证据",
		results_takeaways: "结果与启示",
		limitations_open_questions: "局限与开放问题",
	},
};

const HEADING_COVERAGE_PATTERNS: Record<
	HighEffortTutorialHeadingKey,
	{ strong: RegExp[]; fallback: RegExp[] }
> = {
	research_question: {
		strong: [
			/\babstract\b/,
			/\bintroduction\b/,
			/\bmotivation\b/,
			/\bproblem\b/,
			/\bbackground\b/,
			/摘要/,
			/引言/,
			/研究问题/,
			/背景/,
			/问题/,
		],
		fallback: [/\boverview\b/, /\bsetting\b/, /任务设定/, /问题设定/],
	},
	core_intuition: {
		strong: [
			/\bintuition\b/,
			/\boverview\b/,
			/\bframework\b/,
			/\bidea\b/,
			/直觉/,
			/概览/,
			/总体/,
			/框架/,
		],
		fallback: [/\bmethod\b/, /\bapproach\b/, /方法/, /机制/, /模型/],
	},
	method_breakdown: {
		strong: [
			/\bmethod\b/,
			/\bapproach\b/,
			/\balgorithm\b/,
			/\barchitecture\b/,
			/\btraining\b/,
			/\bmodule\b/,
			/方法/,
			/算法/,
			/架构/,
			/训练/,
			/模块/,
		],
		fallback: [/\bframework\b/, /\bdesign\b/, /框架/, /设计/, /机制/],
	},
	experimental_pipeline: {
		strong: [
			/\bexperiment\b/,
			/\bevaluation\b/,
			/\bimplementation\b/,
			/\bdataset\b/,
			/\bablation\b/,
			/\bbenchmark\b/,
			/\bsetup\b/,
			/实验/,
			/评估/,
			/实现/,
			/数据集/,
			/消融/,
			/设置/,
		],
		fallback: [/\bresult\b/, /\banalysis\b/, /结果/, /分析/, /性能/],
	},
	results_takeaways: {
		strong: [
			/\bresult\b/,
			/\bfinding\b/,
			/\bdiscussion\b/,
			/\bconclusion\b/,
			/\bperformance\b/,
			/结果/,
			/结论/,
			/讨论/,
			/性能/,
			/启示/,
		],
		fallback: [/\bexperiment\b/, /\bevaluation\b/, /实验/, /评估/, /分析/],
	},
	limitations_open_questions: {
		strong: [
			/\blimitation\b/,
			/\bfuture work\b/,
			/\bopen question\b/,
			/\bfailure case\b/,
			/局限/,
			/未来工作/,
			/开放问题/,
			/不足/,
			/失败案例/,
		],
		fallback: [/\bdiscussion\b/, /\bconclusion\b/, /讨论/, /结论/, /分析/],
	},
	formula_mechanism: {
		strong: [/\bformula\b/, /\bequation\b/, /公式/, /推导/],
		fallback: [/\bmethod\b/, /方法/, /机制/],
	},
};

const RULE_BASED_TARGET_HEADINGS: HighEffortTutorialHeadingKey[] =
	HEADING_ORDER.filter(
		(headingKey): headingKey is Exclude<HighEffortTutorialHeadingKey, "formula_mechanism"> =>
			headingKey !== "formula_mechanism"
	);

const IGNORABLE_SECTION_PATTERNS: RegExp[] = [
	/\breferences?\b/,
	/\bbibliography\b/,
	/参考文献/,
	/\bappendix\b/,
	/附录/,
	/\bsupplement(?:ary|al)?\b/,
	/补充材料/,
	/补充说明/,
	/补充实验/,
	/\backnowledg(?:e)?ments?\b/,
	/致谢/,
	/\bauthor contributions?\b/,
	/作者贡献/,
	/\bethics?(?: statement)?\b/,
	/伦理声明/,
	/\bdata availability\b/,
	/数据可用性/,
];

function getHighEffortStyleSupplement(settings: PaperAnalyzerSettings): string {
	return settings.language === "zh-CN"
		? settings.summaryHighPromptZh.trim()
		: settings.summaryHighPrompt.trim();
}

function getHighEffortPromptGuidance(
	settings: PaperAnalyzerSettings,
	includeMarkdownGuidance = false
): string[] {
	if (settings.language === "zh-CN") {
		return [
			"所有自然语言输出都必须使用简体中文书面表达；即使原文是英文，也要把解释译成中文。变量名、公式、论文标题和必要术语可以保留原文。",
			"文风保持书面、克制、接近教程笔记或讲义，不要使用口语化表达，例如“我们可以看到”“这里其实”“简单来说”等。",
			includeMarkdownGuidance
				? "markdown 字段应优先使用短段落、编号列表、项目列表、表格，以及适量 Obsidian callout，例如 > [!note]、> [!tip]、> [!example]、> [!warning]；必要时可用 ==重点==。不要为了装饰而堆砌格式。"
				: "自然语言字段应简洁、明确，避免闲聊式和口语化表达。",
			"不要进入思考模式，不要输出思考过程、<think> 标签或任何中间推理，只返回最终 JSON。",
		];
	}

	return [
		"All natural-language output must be written in English. Even if the source snippet is non-English, translate the explanation into English. Variable names, formulas, paper titles, and indispensable technical terms may stay in their original form.",
		"Maintain a formal tutorial-note tone. Avoid conversational fillers such as \"we can see\", \"basically\", \"simply put\", or chatty asides.",
		includeMarkdownGuidance
			? "The markdown field should favor short paragraphs, numbered lists, bullet lists, tables, and selective Obsidian callouts such as > [!note], > [!tip], > [!example], and > [!warning]. You may also use ==highlight== for emphasis, but do not over-format for decoration."
			: "Natural-language fields should stay concise, precise, and non-conversational.",
		"Do not enter thinking mode. Do not output chain-of-thought, <think> tags, or intermediate reasoning. Return the final JSON only.",
	];
}

function getPhaseMessage(
	phaseKey: SummaryStatusPhaseKey,
	messageKey: string,
	vars?: Record<string, string>
): { phase: string; message: string } {
	const statusKeys = buildSummaryStatusKeys();
	return {
		phase: t(statusKeys[phaseKey].phase),
		message: t(statusKeys[phaseKey].messages[messageKey] ?? messageKey, vars),
	};
}

function buildSummaryStatusKeys(): Record<SummaryStatusPhaseKey, SummaryStatusKeyGroup> {
	return {
		source: {
			phase: "summaryStatus.highSourcePhase",
			messages: {
				default: "summaryStatus.highSourceMessage",
				resolved: "summaryStatus.highSourceResolved",
			},
		},
		planning: {
			phase: "summaryStatus.highPlanningPhase",
			messages: {
				default: "summaryStatus.highPlanningMessage",
			},
		},
		sections: {
			phase: "summaryStatus.highSectionsPhase",
			messages: {
				running: "summaryStatus.highSectionsRunning",
				completed: "summaryStatus.highSectionsCompleted",
				skipped: "summaryStatus.highSectionsSkipped",
			},
		},
		formulas: {
			phase: "summaryStatus.highFormulasPhase",
			messages: {
				running: "summaryStatus.highFormulasRunning",
				completed: "summaryStatus.highFormulasCompleted",
				skipped: "summaryStatus.highFormulasSkipped",
			},
		},
		merge: {
			phase: "summaryStatus.highMergePhase",
			messages: {
				default: "summaryStatus.highMergeMessage",
			},
		},
		review: {
			phase: "summaryStatus.highReviewPhase",
			messages: {
				default: "summaryStatus.highReviewMessage",
				running: "summaryStatus.highReviewRunning",
				disabled: "summaryStatus.highReviewDisabled",
			},
		},
		render: {
			phase: "summaryStatus.highRenderPhase",
			messages: {
				default: "summaryStatus.highRenderMessage",
			},
		},
	};
}

function createProgressController(
	onProgress?: (progress: SummaryQueueProgress) => void
): ProgressController {
	return {
		done: 0,
		total: 6,
		report(progress) {
			onProgress?.({
				done: this.done,
				total: this.total,
				...progress,
			});
		},
		advance(count = 1) {
			this.done += count;
		},
		addTotal(count) {
			this.total += Math.max(0, count);
		},
	};
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function stripLeadingHeadings(value: string): string {
	let remaining = value.replace(/\r\n?/g, "\n").trim();
	while (true) {
		const match = /^(#{1,6}\s+[^\n]+\n+)/.exec(remaining);
		if (!match) break;
		remaining = remaining.slice(match[0].length).trimStart();
	}
	return remaining.trim();
}

function normalizeMarkdownText(value: string): string {
	return sanitizeMarkdownForObsidian(
		stripLeadingHeadings(value)
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
	);
}

function stripMarkdownToProse(value: string): string {
	return value
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/\$\$[\s\S]*?\$\$/g, " ")
		.replace(/\$[^$\n]+\$/g, " ")
		.replace(/^>\s*\[![^\]]+\].*$/gm, " ")
		.replace(/^>\s?/gm, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/^#{1,6}\s+/gm, " ")
		.replace(/[>*`|]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function containsChineseText(value: string): boolean {
	return /[\u3400-\u9fff]/.test(value);
}

function normalizeComparisonText(value: string): string {
	return stripMarkdownToProse(value).toLowerCase();
}

function isLikelySourceLeak(markdown: string, pointer: MarkdownContentPointer): boolean {
	const candidate = normalizeComparisonText(markdown);
	const source = normalizeComparisonText(pointer.content);
	if (!candidate || !source) return false;
	if (candidate === source) return true;
	if (candidate.length >= 120 && source.includes(candidate)) return true;
	const prefix = source.slice(0, Math.min(160, source.length));
	return prefix.length >= 80 && candidate.includes(prefix);
}

function lacksExpectedLanguage(
	markdown: string,
	language: PaperAnalyzerSettings["language"]
): boolean {
	const prose = stripMarkdownToProse(markdown);
	if (prose.length < 24) return false;
	if (language === "zh-CN") return !containsChineseText(prose);
	return false;
}

function isSectionExplanationInsufficient(
	markdown: string,
	pointer: MarkdownContentPointer,
	language: PaperAnalyzerSettings["language"]
): boolean {
	const trimmed = markdown.trim();
	if (!trimmed) return true;
	if (lacksExpectedLanguage(trimmed, language)) return true;
	if (isLikelySourceLeak(trimmed, pointer)) return true;
	return stripMarkdownToProse(trimmed).length < 60;
}

function isFormulaExplanationInsufficient(
	markdown: string,
	pointer: MarkdownContentPointer,
	language: PaperAnalyzerSettings["language"]
): boolean {
	const trimmed = markdown.trim();
	if (!trimmed) return true;
	if (lacksExpectedLanguage(trimmed, language)) return true;
	if (isLikelySourceLeak(trimmed, pointer)) return true;
	return stripMarkdownToProse(trimmed).length < 40;
}

function normalizeFormulaDisplay(value: string): string {
	const trimmed = sanitizeMarkdownForObsidian(value.trim());
	if (!trimmed) return "";
	if (/^\$\$[\s\S]*\$\$$/.test(trimmed)) return trimmed;
	const inner = trimmed.replace(/^\$\$?/, "").replace(/\$\$?$/, "").trim();
	return inner ? `$$\n${inner}\n$$` : "";
}

function unwrapSingleCodeFence(value: string): string {
	const trimmed = value.trim();
	const openingFence = /^```(?:[A-Za-z0-9_-]+)?\s*\n?/.exec(trimmed);
	if (!openingFence) return trimmed;
	const body = trimmed.slice(openingFence[0].length);
	const closingFenceIndex = body.lastIndexOf("```");
	return (closingFenceIndex >= 0 ? body.slice(0, closingFenceIndex) : body).trim();
}

function decodeJsonStringLike(value: string): string {
	let decoded = "";
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index];
		if (char !== "\\") {
			decoded += char;
			continue;
		}

		const next = value[index + 1];
		if (next === undefined) break;

		switch (next) {
			case "n":
				decoded += "\n";
				index += 1;
				break;
			case "r":
				decoded += "\r";
				index += 1;
				break;
			case "t":
				decoded += "\t";
				index += 1;
				break;
			case '"':
				decoded += '"';
				index += 1;
				break;
			case "\\":
				decoded += "\\";
				index += 1;
				break;
			case "/":
				decoded += "/";
				index += 1;
				break;
			case "u": {
				const hex = value.slice(index + 2, index + 6);
				if (/^[0-9a-fA-F]{4}$/.test(hex)) {
					decoded += String.fromCharCode(Number.parseInt(hex, 16));
					index += 5;
					break;
				}
				decoded += "u";
				index += 1;
				break;
			}
			default:
				decoded += next;
				index += 1;
		}
	}
	return decoded;
}

function extractJsonLikeMarkdownField(value: string): string {
	const keyMatch = /"markdown"\s*:\s*"/.exec(value);
	if (!keyMatch) return "";

	let raw = "";
	let escaped = false;
	for (let index = keyMatch.index + keyMatch[0].length; index < value.length; index += 1) {
		const char = value[index];
		if (escaped) {
			raw += char;
			escaped = false;
			continue;
		}
		if (char === "\\") {
			raw += char;
			escaped = true;
			continue;
		}
		if (char === '"') {
			return decodeJsonStringLike(raw).trim();
		}
		raw += char;
	}

	return decodeJsonStringLike(raw).trim();
}

function extractMarkdownFromParsedPayload(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
	const markdown = (value as { markdown?: unknown }).markdown;
	return typeof markdown === "string" ? markdown.trim() : "";
}

function coerceRawMarkdownResponse(rawText: string): string {
	const trimmed = rawText.trim();
	if (!trimmed) return "";

	const directMarkdown = extractMarkdownFromParsedPayload(tryJsonParse<unknown>(trimmed));
	if (directMarkdown) return directMarkdown;

	const unfenced = unwrapSingleCodeFence(trimmed);
	const salvagedMarkdown = extractJsonLikeMarkdownField(unfenced);
	if (salvagedMarkdown) return salvagedMarkdown;
	if (unfenced !== trimmed) {
		const unfencedMarkdown = extractMarkdownFromParsedPayload(
			tryJsonParse<unknown>(unfenced)
		);
		if (unfencedMarkdown) return unfencedMarkdown;
		if (/^[[{]/.test(unfenced)) return "";
		return unfenced;
	}

	if (/^[[{]/.test(trimmed)) return "";
	return trimmed;
}

interface JsonCallResult<T> {
	parsed: T | null;
	rawText: string;
}

function pointerLabel(pointer: MarkdownContentPointer): string {
	return pointer.sectionPath[pointer.sectionPath.length - 1] || pointer.excerpt;
}

function buildPointerMap(bundle: HighEffortSourceBundle): Map<string, MarkdownContentPointer> {
	const pointers = [
		...bundle.sectionPointers,
		...bundle.paragraphPointers,
		...bundle.formulaPointers,
		...bundle.imagePointers,
	];
	return new Map(pointers.map((pointer) => [pointer.id, pointer]));
}

function safeJsonParse<T>(value: string, fallback: T): T {
	const parsed = tryJsonParse<T>(value);
	return parsed ?? fallback;
}

function tryJsonParse<T>(value: string): T | null {
	const trimmed = value.trim();
	const candidates = [trimmed];
	const firstBrace = trimmed.indexOf("{");
	const lastBrace = trimmed.lastIndexOf("}");
	if (firstBrace >= 0 && lastBrace > firstBrace) {
		candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
	}

	for (const candidate of candidates) {
		try {
			return JSON.parse(candidate) as T;
		} catch {
			continue;
		}
	}

	return null;
}

function hasDanglingCodeFence(value: string): boolean {
	const fenceCount = value.match(/```/g)?.length ?? 0;
	return fenceCount % 2 === 1;
}

function looksLikeTruncatedJsonLikeResponse(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return false;
	if (tryJsonParse<unknown>(trimmed)) return false;

	const unfenced = unwrapSingleCodeFence(trimmed).trim();
	if (unfenced && tryJsonParse<unknown>(unfenced)) return false;

	const looksJsonLike =
		/^```json\b/i.test(trimmed) ||
		/^[[{]/.test(unfenced) ||
		/"(?:markdown|revisionRequests|sectionPlans|formulaPointerIds|tutorialTitle)"\s*:/.test(
			unfenced
		);
	if (!looksJsonLike) return false;
	if (/^```json\b/i.test(trimmed) && hasDanglingCodeFence(trimmed)) return true;
	if (/^[[{]/.test(unfenced) && !/[}\]]\s*$/.test(unfenced)) return true;
	return !/[}\]]\s*$/.test(unfenced);
}

function getExpandedHighEffortTokenBudget(maxTokens: number): number {
	return Math.min(
		HIGH_EFFORT_RETRY_MAX_TOKENS,
		Math.max(maxTokens + 400, maxTokens * 2)
	);
}

async function callTextWithRetry(
	config: LlmConfig,
	systemPrompt: string,
	userContent: string,
	signal: AbortSignal | undefined,
	maxTokens: number,
	temperature = 0.15
): Promise<string> {
	const initial = await callLlmTextWithMeta(config, systemPrompt, userContent, signal, {
		responseMode: "text",
		maxTokens,
		temperature,
	});
	if (!initial.truncated || maxTokens >= HIGH_EFFORT_RETRY_MAX_TOKENS) {
		return initial.text;
	}

	const retry = await callLlmTextWithMeta(config, systemPrompt, userContent, signal, {
		responseMode: "text",
		maxTokens: getExpandedHighEffortTokenBudget(maxTokens),
		temperature,
	});
	return retry.text.length >= initial.text.length ? retry.text : initial.text;
}

async function callJsonWithRawText<T>(
	config: LlmConfig,
	systemPrompt: string,
	userContent: string,
	signal: AbortSignal | undefined,
	maxTokens: number,
	temperature = 0.15
): Promise<JsonCallResult<T>> {
	const initial = await callLlmTextWithMeta(config, systemPrompt, userContent, signal, {
		responseMode: "json",
		maxTokens,
		temperature,
	});
	let rawText = initial.text;
	let parsed = tryJsonParse<T>(rawText);
	if (
		(initial.truncated || looksLikeTruncatedJsonLikeResponse(rawText)) &&
		maxTokens < HIGH_EFFORT_RETRY_MAX_TOKENS
	) {
		const retry = await callLlmTextWithMeta(config, systemPrompt, userContent, signal, {
			responseMode: "json",
			maxTokens: getExpandedHighEffortTokenBudget(maxTokens),
			temperature,
		});
		const retryParsed = tryJsonParse<T>(retry.text);
		const shouldUseRetry =
			retryParsed !== null || parsed === null || retry.text.length > rawText.length;
		if (shouldUseRetry) {
			rawText = retry.text;
			parsed = retryParsed;
		}
	}
	return {
		parsed,
		rawText,
	};
}

function buildPlannerPointerList(
	bundle: HighEffortSourceBundle,
	language: PaperAnalyzerSettings["language"]
): string {
	const sections = bundle.sectionPointers
		.map(
			(pointer) =>
				`- ${pointer.id} | ${pointer.sectionPath.join(" > ")} | ${pointer.excerpt}`
		)
		.join("\n");
	const formulas = bundle.formulaPointers
		.map(
			(pointer) =>
				`- ${pointer.id} | ${pointer.sectionPath.join(" > ")} | ${pointer.excerpt}`
		)
		.join("\n");
	if (language === "zh-CN") {
		return [
			`源类型: ${bundle.sourceLabel}`,
			"章节指针:",
			sections || "- none",
			"",
			"公式指针:",
			formulas || "- none",
		].join("\n");
	}

	return [
		`Source: ${bundle.sourceLabel}`,
		"Section pointers:",
		sections || "- none",
		"",
		"Formula pointers:",
		formulas || "- none",
	].join("\n");
}

function inferHeadingFromPointer(pointer: MarkdownContentPointer): HighEffortTutorialHeadingKey {
	const haystack = pointer.sectionPath.join(" ").toLowerCase();
	if (/(abstract|introduction|motivation|problem|background|摘要|引言|研究问题|背景)/.test(haystack)) {
		return "research_question";
	}
	if (/(intuition|overview|framework|overview|贡献|直觉|概览)/.test(haystack)) {
		return "core_intuition";
	}
	if (/(method|approach|algorithm|architecture|training|方法|模型|算法|训练)/.test(haystack)) {
		return "method_breakdown";
	}
	if (/(experiment|evaluation|dataset|implementation|ablation|实验|评估|消融)/.test(haystack)) {
		return "experimental_pipeline";
	}
	if (/(result|discussion|conclusion|finding|结论|讨论|结果)/.test(haystack)) {
		return "results_takeaways";
	}
	if (/(limitation|future|open question|局限|未来工作)/.test(haystack)) {
		return "limitations_open_questions";
	}
	return "core_intuition";
}

function fallbackPlannerResult(bundle: HighEffortSourceBundle): HighEffortPlannerResult {
	const sortedSections = [...bundle.sectionPointers].sort(
		(left, right) => left.charStart - right.charStart
	);
	const sortedFormulas = [...bundle.formulaPointers].sort(
		(left, right) => left.charStart - right.charStart
	);
	return {
		tutorialTitle: bundle.paperTitle,
		sectionPlans: sortedSections.slice(0, MAX_PLANNED_SECTIONS).map((pointer) => ({
			pointerId: pointer.id,
			targetHeading: inferHeadingFromPointer(pointer),
			goal: pointer.excerpt,
		})),
		formulaPointerIds: sortedFormulas
			.slice(0, MAX_PLANNED_FORMULAS)
			.map((pointer) => pointer.id),
		imagePlans: [],
		narrativeFocus: [],
	};
}

function scoreSectionPointerForHeading(
	pointer: MarkdownContentPointer,
	headingKey: HighEffortTutorialHeadingKey,
	totalSections: number
): number {
	if (pointer.kind !== "section") return Number.NEGATIVE_INFINITY;
	const haystack = `${pointer.sectionPath.join(" ")} ${pointer.excerpt} ${pointer.content.slice(0, 500)}`.toLowerCase();
	const patternGroup = HEADING_COVERAGE_PATTERNS[headingKey];
	let score = 0;
	for (const pattern of patternGroup.strong) {
		if (pattern.test(haystack)) score += 6;
	}
	for (const pattern of patternGroup.fallback) {
		if (pattern.test(haystack)) score += 3;
	}

	if (headingKey === "research_question" && pointer.ordinal <= Math.max(2, Math.ceil(totalSections * 0.25))) {
		score += 2;
	}
	if (
		(headingKey === "results_takeaways" || headingKey === "limitations_open_questions") &&
		pointer.ordinal >= Math.max(1, Math.floor(totalSections * 0.65))
	) {
		score += 2;
	}
	if (headingKey === "method_breakdown" && /method|approach|algorithm|architecture|方法|算法|架构/.test(haystack)) {
		score += 2;
	}
	if (headingKey === "experimental_pipeline" && /experiment|evaluation|dataset|ablation|实验|评估|数据集|消融/.test(haystack)) {
		score += 2;
	}
	if (headingKey === "limitations_open_questions" && /discussion|conclusion|讨论|结论/.test(haystack)) {
		score += 1;
	}
	return score;
}

function pickPositionalFallbackPointer(
	bundle: HighEffortSourceBundle,
	headingKey: HighEffortTutorialHeadingKey,
	sectionPlanUseCount: Map<string, number>
): MarkdownContentPointer | null {
	const sorted = [...bundle.sectionPointers].sort((left, right) => left.charStart - right.charStart);
	const candidates =
		headingKey === "results_takeaways" || headingKey === "limitations_open_questions"
			? [...sorted].reverse()
			: sorted;

	let bestPointer: MarkdownContentPointer | null = null;
	let lowestUseCount = Number.POSITIVE_INFINITY;
	for (const pointer of candidates) {
		const useCount = sectionPlanUseCount.get(pointer.id) ?? 0;
		if (useCount < lowestUseCount) {
			lowestUseCount = useCount;
			bestPointer = pointer;
		}
	}
	return bestPointer;
}

function pickBestSectionPointerForHeading(
	bundle: HighEffortSourceBundle,
	headingKey: HighEffortTutorialHeadingKey,
	sectionPlans: HighEffortPlannerResult["sectionPlans"]
): MarkdownContentPointer | null {
	const totalSections = Math.max(1, bundle.sectionPointers.length);
	const sectionPlanUseCount = new Map<string, number>();
	for (const plan of sectionPlans) {
		sectionPlanUseCount.set(plan.pointerId, (sectionPlanUseCount.get(plan.pointerId) ?? 0) + 1);
	}

	let bestPointer: MarkdownContentPointer | null = null;
	let bestScore = Number.NEGATIVE_INFINITY;
	for (const pointer of bundle.sectionPointers) {
		const alreadyUsedForHeading = sectionPlans.some(
			(plan) => plan.targetHeading === headingKey && plan.pointerId === pointer.id
		);
		if (alreadyUsedForHeading) continue;

		let score = scoreSectionPointerForHeading(pointer, headingKey, totalSections);
		const useCount = sectionPlanUseCount.get(pointer.id) ?? 0;
		score -= useCount * 2;
		if (score > bestScore) {
			bestScore = score;
			bestPointer = pointer;
		}
	}

	if (bestPointer && bestScore > 0) return bestPointer;
	return pickPositionalFallbackPointer(bundle, headingKey, sectionPlanUseCount);
}

function buildCoverageGoal(
	headingKey: HighEffortTutorialHeadingKey,
	pointer: MarkdownContentPointer,
	language: PaperAnalyzerSettings["language"]
): string {
	const label = pointerLabel(pointer);
	if (language === "zh-CN") {
		switch (headingKey) {
			case "research_question":
				return `交代这篇论文真正要解决的问题，并说明 ${label} 与研究背景的关系。`;
			case "core_intuition":
				return `提炼 ${label} 背后的核心直觉，并解释为什么这个思路成立。`;
			case "method_breakdown":
				return `拆解 ${label} 中的方法流程、关键设计和实现逻辑。`;
			case "experimental_pipeline":
				return `说明 ${label} 对应的实验设置、数据、评测流程和证据组织方式。`;
			case "results_takeaways":
				return `总结 ${label} 给出的主要结果、证据强弱和可以得出的结论。`;
			case "limitations_open_questions":
				return `从 ${label} 中提炼局限、未解问题或值得继续追问的方向。`;
			default:
				return pointer.excerpt;
		}
	}

	switch (headingKey) {
		case "research_question":
			return `Explain the paper's real research problem and how ${label} frames the background.`;
		case "core_intuition":
			return `Extract the core intuition behind ${label} and explain why the idea works.`;
		case "method_breakdown":
			return `Break down the method flow, critical design choices, and implementation logic in ${label}.`;
		case "experimental_pipeline":
			return `Explain the experimental setup, data, evaluation pipeline, and evidence structure in ${label}.`;
		case "results_takeaways":
			return `Summarize the main results in ${label}, how strong the evidence is, and what conclusions follow.`;
		case "limitations_open_questions":
			return `Extract limitations, unresolved questions, or future directions signaled by ${label}.`;
		default:
			return pointer.excerpt;
	}
}

function sortSectionPlans(
	sectionPlans: HighEffortPlannerResult["sectionPlans"],
	bundle: HighEffortSourceBundle
): HighEffortPlannerResult["sectionPlans"] {
	const pointerMap = buildPointerMap(bundle);
	return [...sectionPlans].sort((left, right) => {
		const leftHeadingIndex = HEADING_ORDER.indexOf(left.targetHeading);
		const rightHeadingIndex = HEADING_ORDER.indexOf(right.targetHeading);
		if (leftHeadingIndex !== rightHeadingIndex) {
			return leftHeadingIndex - rightHeadingIndex;
		}
		const leftPointer = pointerMap.get(left.pointerId);
		const rightPointer = pointerMap.get(right.pointerId);
		return (leftPointer?.charStart ?? 0) - (rightPointer?.charStart ?? 0);
	});
}

function ensurePlannerCoverage(
	planner: HighEffortPlannerResult,
	bundle: HighEffortSourceBundle,
	language: PaperAnalyzerSettings["language"]
): HighEffortPlannerResult {
	const sectionPlans = [...planner.sectionPlans];
	const coveredHeadings = new Set(sectionPlans.map((plan) => plan.targetHeading));

	for (const headingKey of HEADING_COVERAGE_TARGETS) {
		if (coveredHeadings.has(headingKey)) continue;
		const pointer = pickBestSectionPointerForHeading(bundle, headingKey, sectionPlans);
		if (!pointer) continue;
		sectionPlans.push({
			pointerId: pointer.id,
			targetHeading: headingKey,
			goal: buildCoverageGoal(headingKey, pointer, language),
		});
		coveredHeadings.add(headingKey);
	}

	return {
		...planner,
		sectionPlans: sortSectionPlans(sectionPlans, bundle),
	};
}

function normalizePlannerResult(
	raw: HighEffortPlannerResult,
	bundle: HighEffortSourceBundle,
	language: PaperAnalyzerSettings["language"]
): HighEffortPlannerResult {
	const pointerMap = buildPointerMap(bundle);
	const fallback = fallbackPlannerResult(bundle);
	const validHeading = new Set<HighEffortTutorialHeadingKey>(HEADING_ORDER);
	const sectionPlans = (Array.isArray(raw.sectionPlans) ? raw.sectionPlans : [])
		.filter((plan) => typeof plan?.pointerId === "string")
		.map((plan) => {
			const pointer = pointerMap.get(plan.pointerId);
			if (!pointer || pointer.kind !== "section") return null;
			const targetHeading = validHeading.has(plan.targetHeading)
				? plan.targetHeading
				: inferHeadingFromPointer(pointer);
			return {
				pointerId: pointer.id,
				targetHeading,
				goal: normalizeWhitespace(plan.goal || pointer.excerpt) || pointer.excerpt,
			};
		})
		.filter((plan): plan is HighEffortPlannerResult["sectionPlans"][number] => !!plan)
		.slice(0, MAX_PLANNED_SECTIONS);

	const formulaPointerIds = (Array.isArray(raw.formulaPointerIds) ? raw.formulaPointerIds : [])
		.filter((pointerId): pointerId is string => typeof pointerId === "string")
		.filter((pointerId) => pointerMap.get(pointerId)?.kind === "formula")
		.slice(0, MAX_PLANNED_FORMULAS);

	const normalized = {
		tutorialTitle: normalizeWhitespace(raw.tutorialTitle || bundle.paperTitle) || bundle.paperTitle,
		sectionPlans: sectionPlans.length > 0 ? sectionPlans : fallback.sectionPlans,
		formulaPointerIds:
			formulaPointerIds.length > 0 ? formulaPointerIds : fallback.formulaPointerIds,
		imagePlans: [],
		narrativeFocus: Array.isArray(raw.narrativeFocus)
			? raw.narrativeFocus
				.filter((entry): entry is string => typeof entry === "string")
				.map((entry) => normalizeWhitespace(entry))
				.filter(Boolean)
				.slice(0, 6)
			: [],
	};

	return ensurePlannerCoverage(normalized, bundle, language);
}

function isIgnorableSectionText(
	sectionPath: string[],
	excerpt: string,
	content: string
): boolean {
	const haystack = `${sectionPath.join(" ")} ${excerpt} ${content.slice(0, 240)}`.toLowerCase();
	return IGNORABLE_SECTION_PATTERNS.some((pattern) => pattern.test(haystack));
}

function isIgnorableSectionPointer(pointer: MarkdownContentPointer): boolean {
	return isIgnorableSectionText(pointer.sectionPath, pointer.excerpt, pointer.content);
}

function inferRuleBasedHeading(
	pointer: MarkdownContentPointer,
	totalSections: number
): HighEffortTutorialHeadingKey {
	let bestHeading: HighEffortTutorialHeadingKey = inferHeadingFromPointer(pointer);
	let bestScore = Number.NEGATIVE_INFINITY;

	for (const headingKey of RULE_BASED_TARGET_HEADINGS) {
		const score = scoreSectionPointerForHeading(pointer, headingKey, totalSections);
		if (score > bestScore) {
			bestScore = score;
			bestHeading = headingKey;
		}
	}

	return bestScore > 0 ? bestHeading : inferHeadingFromPointer(pointer);
}

function buildRuleBasedPlanner(
	bundle: HighEffortSourceBundle,
	language: PaperAnalyzerSettings["language"]
): HighEffortPlannerResult {
	const filteredSections = bundle.sectionPointers.filter(
		(pointer) => !isIgnorableSectionPointer(pointer)
	);
	const selectedSections = filteredSections.length > 0 ? filteredSections : bundle.sectionPointers;
	const totalSections = Math.max(1, selectedSections.length);

	const sectionPlans = selectedSections.map((pointer) => {
		const targetHeading = inferRuleBasedHeading(pointer, totalSections);
		return {
			pointerId: pointer.id,
			targetHeading,
			goal: buildCoverageGoal(targetHeading, pointer, language),
		};
	});

	const formulaPointerIds = bundle.formulaPointers
		.filter(
			(pointer) =>
				!isIgnorableSectionText(pointer.sectionPath, pointer.excerpt, pointer.content)
		)
		.map((pointer) => pointer.id);

	return ensurePlannerCoverage(
		{
			tutorialTitle: bundle.paperTitle,
			sectionPlans: sortSectionPlans(sectionPlans, bundle),
			formulaPointerIds,
			imagePlans: [],
			narrativeFocus: [],
		},
		bundle,
		language
	);
}

function getPlannerPrompt(settings: PaperAnalyzerSettings): string {
	const style = getHighEffortStyleSupplement(settings);
	if (settings.language === "zh-CN") {
		return [
			"你是一名科研教程策划助手。请基于论文结构指针规划一个高强度、教程式、书面化的论文讲解。",
			"只返回 JSON，不要输出额外解释。",
			"JSON 结构：{\"tutorialTitle\":string,\"sectionPlans\":[{\"pointerId\":string,\"targetHeading\":\"research_question|core_intuition|method_breakdown|experimental_pipeline|results_takeaways|limitations_open_questions\",\"goal\":string}],\"formulaPointerIds\":string[],\"imagePlans\":[],\"narrativeFocus\":string[]}",
			`要求：选择 4 到 ${MAX_PLANNED_SECTIONS} 个 section pointer，尽量覆盖问题、核心直觉、方法、实验、结果与局限。`,
			`最多选择 ${MAX_PLANNED_FORMULAS} 个公式 pointer。`,
			"不要编造缺失章节；如果论文没有明显局限，就用 discussion/conclusion 中最接近的部分。",
			...getHighEffortPromptGuidance(settings, false),
			"以下用户风格补充仅用于语气和结构倾向，不是唯一输出格式：",
			style,
		].join("\n\n");
	}

	return [
		"You are planning a high-effort, tutorial-style, formally written paper explanation.",
		"Return JSON only.",
		"JSON schema: {\"tutorialTitle\":string,\"sectionPlans\":[{\"pointerId\":string,\"targetHeading\":\"research_question|core_intuition|method_breakdown|experimental_pipeline|results_takeaways|limitations_open_questions\",\"goal\":string}],\"formulaPointerIds\":string[],\"imagePlans\":[],\"narrativeFocus\":string[]}",
		`Choose 4 to ${MAX_PLANNED_SECTIONS} section pointers and aim to cover the research problem, core intuition, method, experiments, results, and limitations whenever the source supports them.`,
		`Choose at most ${MAX_PLANNED_FORMULAS} formula pointers.`,
		"Do not invent missing sections. If limitations are unclear, use the most relevant discussion or conclusion section.",
		...getHighEffortPromptGuidance(settings, false),
		"The following user style supplement only affects tone and structure preference:",
		style,
	].join("\n\n");
}

function getSectionExplainerPrompt(settings: PaperAnalyzerSettings): string {
	const style = getHighEffortStyleSupplement(settings);
	if (settings.language === "zh-CN") {
		return [
			"你是一名科研导师。请把单个章节解释成正式、清晰、教程式的 Markdown。",
			"只返回 JSON：{\"markdown\":string,\"figureMentions\":string[],\"figureNote\":string}",
			"要求：markdown 字段只写该章节应当插入到最终教程中的正文；不要生成顶层 ## 标题。",
			"不要大段复制原文，不要把英文原段落直接贴进结果；应当改写、解释并组织成教程式表达。",
			"优先解释：问题是什么、直觉理解、正式机制、为什么重要、容易误解的点。",
			"如果源文本里提到了 Figure/Fig.，再把 figureMentions 填成类似 [\"Figure 2\"]，并在 figureNote 写 1 到 2 句图像前导说明；否则返回空数组和空字符串。",
			"只使用提供的指针内容，不要猜测。",
			...getHighEffortPromptGuidance(settings, true),
			style,
		].join("\n\n");
	}

	return [
		"You are a research tutor. Expand one source section into formal, tutorial-style Markdown.",
		"Return JSON only: {\"markdown\":string,\"figureMentions\":string[],\"figureNote\":string}.",
		"The markdown field should contain only the body that belongs inside the final tutorial; do not emit top-level ## headings.",
		"Do not paste long source passages verbatim. Rewrite and explain them in tutorial form instead of copying the paper's prose.",
		"Prioritize what the problem is, the intuition, the formal mechanism, why it matters, and likely misunderstandings.",
		"Only if the source text explicitly mentions Figure/Fig. should you populate figureMentions like [\"Figure 2\"] and write a 1-2 sentence figureNote; otherwise return an empty array and empty string.",
		"Use only the provided source pointer content. Do not guess.",
		...getHighEffortPromptGuidance(settings, true),
		style,
	].join("\n\n");
}

function getFormulaExplainerPrompt(settings: PaperAnalyzerSettings): string {
	const style = getHighEffortStyleSupplement(settings);
	if (settings.language === "zh-CN") {
		return [
			"你是一名科研数学讲解助手。请把单个公式解释成正式、教程式的 Markdown。",
			"只返回 JSON：{\"markdown\":string}",
			"解释顺序优先是：公式重写、变量释义、数学直觉、它在文中起什么作用、什么时候可能失效。",
			"不要只输出公式本体；必须包含解释性文字，并尽量用列表或 callout 说明关键变量。",
			"不要生成顶层 ## 标题。只基于提供的公式和附近上下文，不要脑补。",
			...getHighEffortPromptGuidance(settings, true),
			style,
		].join("\n\n");
	}

	return [
		"You are a research math explainer. Turn one paper formula into formal tutorial-style Markdown.",
		"Return JSON only: {\"markdown\":string}.",
		"Explain in this order when possible: rewritten formula, variable meanings, mathematical intuition, role in the paper, and where it may fail.",
		"Do not output the bare formula alone. Include explanatory prose and, when helpful, bullets or a callout for key variables.",
		"Do not emit top-level ## headings. Use only the supplied formula and nearby context. Do not invent missing details.",
		...getHighEffortPromptGuidance(settings, true),
		style,
	].join("\n\n");
}

function getSectionRepairPrompt(settings: PaperAnalyzerSettings): string {
	if (settings.language === "zh-CN") {
		return [
			"你正在修复一段不合格的科研教程章节输出。",
			"直接返回 Markdown，不要 JSON。",
			"不要复制原文句子，不要保留英文原段落，不要生成顶层 ## 标题。",
			"必须把内容改写成简体中文的教程式讲解，并解释这段内容为什么重要。",
			...getHighEffortPromptGuidance(settings, true),
		].join("\n\n");
	}

	return [
		"You are repairing an invalid tutorial section output.",
		"Return Markdown only, not JSON.",
		"Do not paste source sentences verbatim and do not emit top-level ## headings.",
		"Rewrite the content into a clear tutorial explanation in English and explain why it matters.",
		...getHighEffortPromptGuidance(settings, true),
	].join("\n\n");
}

function getFormulaRepairPrompt(settings: PaperAnalyzerSettings): string {
	if (settings.language === "zh-CN") {
		return [
			"你正在修复一段不合格的公式讲解输出。",
			"直接返回 Markdown，不要 JSON。",
			"必须包含：1）公式本体；2）关键变量或符号说明；3）这条公式在文中的作用。",
			"不要只输出公式，不要复制原文段落，不要生成顶层 ## 标题。",
			...getHighEffortPromptGuidance(settings, true),
		].join("\n\n");
	}

	return [
		"You are repairing an invalid formula explanation output.",
		"Return Markdown only, not JSON.",
		"The answer must include the formula, key variable or symbol explanations, and the formula's role in the paper.",
		"Do not output the bare formula alone, do not copy source prose verbatim, and do not emit top-level ## headings.",
		...getHighEffortPromptGuidance(settings, true),
	].join("\n\n");
}

function getReviewerPrompt(settings: PaperAnalyzerSettings): string {
	if (settings.language === "zh-CN") {
		return [
			"你是一名科研教程审稿助手。请检查草稿是否过于凝练、有没有未解释的新概念、公式变量缺失说明、或图文脱节。",
			"只返回 JSON：{\"revisionRequests\":[{\"pointerIds\":string[],\"targetHeading\":\"research_question|core_intuition|method_breakdown|formula_mechanism|experimental_pipeline|results_takeaways|limitations_open_questions\",\"issue\":string,\"instruction\":string}]}",
			`最多输出 ${MAX_REVISION_REQUESTS} 条 revision request。`,
			"revision request 只能引用提供的 pointerId；如果没有明显缺口，返回空数组。",
			"不要直接改稿。",
			...getHighEffortPromptGuidance(settings, false),
		].join("\n\n");
	}

	return [
		"You are reviewing a tutorial-style paper draft.",
		"Check whether the draft is too compressed, leaves new concepts unexplained, omits formula variables, or disconnects figures from the surrounding explanation.",
		"Return JSON only: {\"revisionRequests\":[{\"pointerIds\":string[],\"targetHeading\":\"research_question|core_intuition|method_breakdown|formula_mechanism|experimental_pipeline|results_takeaways|limitations_open_questions\",\"issue\":string,\"instruction\":string}]}",
		`Return at most ${MAX_REVISION_REQUESTS} revision requests and only reference provided pointerIds.`,
		"If the draft is already sufficient, return an empty array. Do not rewrite the draft.",
		...getHighEffortPromptGuidance(settings, false),
	].join("\n\n");
}

function getExpansionPrompt(settings: PaperAnalyzerSettings): string {
	if (settings.language === "zh-CN") {
		return [
			"你是一名科研教程补讲助手。请根据 revision request 和指定原文指针写一小段补充说明。",
			"只返回 JSON：{\"markdown\":string}",
			"这段补充会被拼接进现有草稿，所以不要重复整节内容，也不要生成顶层 ## 标题。",
			"必须解决指定 issue，并引用给定指针中的关键信息。",
			...getHighEffortPromptGuidance(settings, true),
		].join("\n\n");
	}

	return [
		"You are writing a focused tutorial expansion for an existing paper draft.",
		"Return JSON only: {\"markdown\":string}.",
		"This will be appended to the current draft section, so do not rewrite the whole section and do not emit top-level ## headings.",
		"Resolve the stated issue using only the supplied pointers.",
		...getHighEffortPromptGuidance(settings, true),
	].join("\n\n");
}

async function callJson<T>(
	config: LlmConfig,
	systemPrompt: string,
	userContent: string,
	signal: AbortSignal | undefined,
	fallback: T,
	maxTokens: number,
	temperature = 0.15
): Promise<T> {
	const response = await callJsonWithRawText<T>(
		config,
		systemPrompt,
		userContent,
		signal,
		maxTokens,
		temperature
	);
	return response.parsed ?? fallback;
}

function buildPlannerUserContent(bundle: HighEffortSourceBundle, settings: PaperAnalyzerSettings): string {
	if (settings.language === "zh-CN") {
		return [
			`论文标题: ${bundle.paperTitle}`,
			`源提供者: ${bundle.sourceLabel}`,
			"请基于以下结构指针决定教程式总结应重点展开哪些章节和公式。",
			buildPlannerPointerList(bundle, settings.language),
		].join("\n\n");
	}

	return [
		`Paper title: ${bundle.paperTitle}`,
		`Source provider: ${bundle.sourceLabel}`,
		"Use the following structural pointers to decide which sections and formulas deserve detailed tutorial treatment.",
		buildPlannerPointerList(bundle, settings.language),
	].join("\n\n");
}

function buildSectionUserContent(
	plan: HighEffortPlannerResult["sectionPlans"][number],
	pointer: MarkdownContentPointer,
	settings: PaperAnalyzerSettings
): string {
	if (settings.language === "zh-CN") {
		return [
			`目标教程章节: ${TUTORIAL_HEADINGS[settings.language][plan.targetHeading]}`,
			`章节路径: ${pointer.sectionPath.join(" > ")}`,
			`讲解目标: ${plan.goal}`,
			`指针 ID: ${pointer.id}`,
			"原文片段:",
			pointer.content,
		].join("\n\n");
	}

	return [
		`Target tutorial section: ${TUTORIAL_HEADINGS[settings.language][plan.targetHeading]}`,
		`Section path: ${pointer.sectionPath.join(" > ")}`,
		`Teaching goal: ${plan.goal}`,
		`Pointer ID: ${pointer.id}`,
		"Source snippet:",
		pointer.content,
	].join("\n\n");
}

function buildFormulaUserContent(
	formulaPointer: MarkdownContentPointer,
	sectionPointer: MarkdownContentPointer | undefined,
	settings: PaperAnalyzerSettings
): string {
	const nearbyContext = sectionPointer?.content ?? "";
	if (settings.language === "zh-CN") {
		return [
			`公式指针: ${formulaPointer.id}`,
			`所属章节: ${formulaPointer.sectionPath.join(" > ")}`,
			"公式:",
			formulaPointer.content,
			"附近上下文:",
			nearbyContext,
		].join("\n\n");
	}

	return [
		`Formula pointer: ${formulaPointer.id}`,
		`Section path: ${formulaPointer.sectionPath.join(" > ")}`,
		"Formula:",
		formulaPointer.content,
		"Nearby context:",
		nearbyContext,
	].join("\n\n");
}

function buildReviewerUserContent(
	bundle: HighEffortSourceBundle,
	draft: string,
	planner: HighEffortPlannerResult,
	settings: PaperAnalyzerSettings
): string {
	const pointerIds = new Set<string>([
		...planner.sectionPlans.map((plan) => plan.pointerId),
		...planner.formulaPointerIds,
	]);
	const relevantPointers = [...buildPointerMap(bundle).values()]
		.filter((pointer) => pointerIds.has(pointer.id))
		.map(
			(pointer) =>
				`- ${pointer.id} | ${pointer.kind} | ${pointer.sectionPath.join(" > ")} | ${pointer.excerpt}`
		)
		.join("\n");

	if (settings.language === "zh-CN") {
		return [
			"请审阅以下教程草稿，并只针对真正缺失的点提出 revision requests。",
			"可用指针:",
			relevantPointers || "- none",
			"",
			"当前草稿:",
			draft,
		].join("\n\n");
	}

	return [
		"Review the following tutorial draft and produce revision requests only for meaningful gaps.",
		"Available pointers:",
		relevantPointers || "- none",
		"",
		"Current draft:",
		draft,
	].join("\n\n");
}

function buildExpansionUserContent(
	revision: HighEffortRevisionRequest,
	pointers: MarkdownContentPointer[],
	settings: PaperAnalyzerSettings
): string {
	const pointerText = pointers
		.map(
			(pointer) =>
				`- ${pointer.id} | ${pointer.sectionPath.join(" > ")}\n${pointer.content}`
		)
		.join("\n\n");
	if (settings.language === "zh-CN") {
		return [
			`目标章节: ${TUTORIAL_HEADINGS[settings.language][revision.targetHeading]}`,
			`问题: ${revision.issue}`,
			`补讲要求: ${revision.instruction}`,
			"回看指针:",
			pointerText,
		].join("\n\n");
	}

	return [
		`Target section: ${TUTORIAL_HEADINGS[settings.language][revision.targetHeading]}`,
		`Issue: ${revision.issue}`,
		`Expansion request: ${revision.instruction}`,
		"Pointers to revisit:",
		pointerText,
	].join("\n\n");
}

async function runFanoutStage<TInput, TOutput>(options: {
	items: TInput[];
	concurrency: number;
	phase: string;
	buildMessage: (done: number, total: number, item: TInput) => string;
	currentLabel: (item: TInput) => string;
	runItem: (item: TInput, index: number) => Promise<TOutput>;
	progress: ProgressController;
	signal?: AbortSignal;
}): Promise<TOutput[]> {
	const results: TOutput[] = [];
	if (options.items.length === 0) return results;

	let nextIndex = 0;
	let activeWorkers = 0;
	let completed = 0;

	const worker = async () => {
		while (nextIndex < options.items.length) {
			options.signal?.throwIfAborted();
			const currentIndex = nextIndex;
			nextIndex += 1;
			const item = options.items[currentIndex];
			if (!item) return;

			activeWorkers += 1;
			options.progress.report({
				phase: options.phase,
				message: options.buildMessage(completed, options.items.length, item),
				activeWorkers,
				pendingWorkers: options.items.length - completed - activeWorkers,
				currentPointerLabel: options.currentLabel(item),
			});

			try {
				results[currentIndex] = await options.runItem(item, currentIndex);
				completed += 1;
				options.progress.advance();
				options.progress.report({
					phase: options.phase,
					message: options.buildMessage(completed, options.items.length, item),
					activeWorkers: Math.max(0, activeWorkers - 1),
					pendingWorkers: options.items.length - completed - Math.max(0, activeWorkers - 1),
					currentPointerLabel: options.currentLabel(item),
				});
			} finally {
				activeWorkers = Math.max(0, activeWorkers - 1);
			}
		}
	};

	const workerCount = Math.max(1, Math.min(options.concurrency, options.items.length));
	await Promise.all(Array.from({ length: workerCount }, worker));
	return results;
}

function findOwningSection(
	bundle: HighEffortSourceBundle,
	pointer: MarkdownContentPointer
): MarkdownContentPointer | undefined {
	return bundle.sectionPointers.find(
		(section) =>
			section.charStart <= pointer.charStart && section.charEnd >= pointer.charEnd
	);
}

function extractFigureMentions(text: string): string[] {
	const matches = text.match(/(?:Figure|Fig\.?)[ ]*\d+/gi) ?? [];
	return Array.from(new Set(matches.map((match) => match.replace(/\s+/g, " ").trim())));
}

function resolveImagePointerIds(
	bundle: HighEffortSourceBundle,
	sectionPointer: MarkdownContentPointer,
	figureMentions: string[]
): string[] {
	const mentions = figureMentions.length > 0 ? figureMentions : extractFigureMentions(sectionPointer.content);
	const resolved = new Set<string>();
	for (const mention of mentions) {
		const figureNumber = /(?:Figure|Fig\.?)[ ]*(\d+)/i.exec(mention)?.[1];
		for (const imagePointer of bundle.imagePointers) {
			const sameSection = imagePointer.sectionPath.join(" > ") === sectionPointer.sectionPath.join(" > ");
			const numberMatch = figureNumber
				? new RegExp(`(?:figure|fig\\.?|image)[ ]*${figureNumber}`, "i").test(imagePointer.content)
				: false;
			if (sameSection || numberMatch) {
				resolved.add(imagePointer.id);
			}
		}
	}

	if (resolved.size === 0) {
		for (const imagePointer of bundle.imagePointers) {
			if (imagePointer.sectionPath.join(" > ") === sectionPointer.sectionPath.join(" > ")) {
				resolved.add(imagePointer.id);
			}
		}
	}

	return Array.from(resolved).slice(0, 2);
}

function normalizeExplainerOutput(
	pointer: MarkdownContentPointer,
	targetHeading: HighEffortTutorialHeadingKey,
	raw: Partial<HighEffortExplainerOutput>,
	language: PaperAnalyzerSettings["language"],
	bundle?: HighEffortSourceBundle
): HighEffortExplainerOutput {
	const markdown = normalizeMarkdownText(raw.markdown || "");
	const figureMentions = Array.isArray(raw.figureMentions)
		? raw.figureMentions.filter((entry): entry is string => typeof entry === "string")
		: [];
	const imagePointerIds = bundle ? resolveImagePointerIds(bundle, pointer, figureMentions) : [];
	const figureNote =
		typeof raw.figureNote === "string" && raw.figureNote.trim()
			? raw.figureNote.trim()
			: imagePointerIds.length > 0
				? language === "zh-CN"
					? "这张图与上文讲解直接相关，放在这里便于对照理解。"
					: "This figure is referenced by the surrounding explanation and is inserted here for direct lookup."
				: "";
	return {
		pointerId: pointer.id,
		targetHeading,
		markdown,
		imagePointerIds,
		figureMentions,
		figureNote,
	};
}

function renderExplainerBlock(title: string, markdown: string): string {
	const trimmed = markdown.trim();
	if (!trimmed) return "";
	if (/^#{1,6}\s+/.test(trimmed)) {
		return trimmed;
	}
	return `### ${title}\n${trimmed}`;
}

function buildSectionSafetyNetMarkdown(
	plan: HighEffortPlannerResult["sectionPlans"][number],
	pointer: MarkdownContentPointer,
	language: PaperAnalyzerSettings["language"]
): string {
	const sectionName = pointer.sectionPath[pointer.sectionPath.length - 1] || pointer.excerpt;
	if (language === "zh-CN") {
		return [
			`> [!note] 这一部分对应论文中的 **${sectionName}**。`,
			`当前可直接确认的重点是：${plan.goal || pointer.excerpt}`,
			"更细的技术细节需要继续结合原文该节核对，因此此处先保留最小化讲解。",
		].join("\n\n");
	}

	return [
		`> [!note] This part corresponds to **${sectionName}** in the paper.`,
		`The safest confirmed focus is: ${plan.goal || pointer.excerpt}`,
		"Finer technical details still need to be checked against the original section, so this fallback keeps the explanation intentionally minimal.",
	].join("\n\n");
}

function buildFormulaSafetyNetMarkdown(
	formulaPointer: MarkdownContentPointer,
	sectionPointer: MarkdownContentPointer | undefined,
	language: PaperAnalyzerSettings["language"]
): string {
	const formulaBlock = normalizeFormulaDisplay(formulaPointer.content);
	const sectionName =
		sectionPointer?.sectionPath[sectionPointer.sectionPath.length - 1] ||
		formulaPointer.sectionPath[formulaPointer.sectionPath.length - 1] ||
		formulaPointer.excerpt;
	const roleHint = sectionPointer?.excerpt || formulaPointer.excerpt;
	if (language === "zh-CN") {
		return [
			formulaBlock,
			"> [!note] 最小化公式说明",
			`> 该公式位于 **${sectionName}**，当前可确认它与“${roleHint}”直接相关。`,
			"> 更细的变量释义需要继续结合上下文核对，因此这里先保留公式本体与作用说明。",
		].filter(Boolean).join("\n\n");
	}

	return [
		formulaBlock,
		"> [!note] Minimal formula note",
		`> This formula appears in **${sectionName}** and is directly tied to "${roleHint}".`,
		"> Finer variable definitions still need to be checked against the nearby source context, so this fallback keeps only the safest role-level explanation.",
	].filter(Boolean).join("\n\n");
}

function buildSectionRepairUserContent(
	plan: HighEffortPlannerResult["sectionPlans"][number],
	pointer: MarkdownContentPointer,
	settings: PaperAnalyzerSettings,
	previousOutput: string
): string {
	if (settings.language === "zh-CN") {
		return [
			`目标教程章节: ${TUTORIAL_HEADINGS[settings.language][plan.targetHeading]}`,
			`章节路径: ${pointer.sectionPath.join(" > ")}`,
			`讲解目标: ${plan.goal}`,
			"上一次输出不合格，原因是它复制了原文、语言不一致，或缺少解释。",
			"请重写为正式的中文教程式 Markdown。",
			"原文片段:",
			pointer.content,
			"无效输出:",
			previousOutput || "<empty>",
		].join("\n\n");
	}

	return [
		`Target tutorial section: ${TUTORIAL_HEADINGS[settings.language][plan.targetHeading]}`,
		`Section path: ${pointer.sectionPath.join(" > ")}`,
		`Teaching goal: ${plan.goal}`,
		"The previous output was invalid because it copied the source, used the wrong language, or failed to explain the content.",
		"Rewrite it as formal English tutorial Markdown.",
		"Source snippet:",
		pointer.content,
		"Invalid output:",
		previousOutput || "<empty>",
	].join("\n\n");
}

function buildFormulaRepairUserContent(
	formulaPointer: MarkdownContentPointer,
	sectionPointer: MarkdownContentPointer | undefined,
	settings: PaperAnalyzerSettings,
	previousOutput: string
): string {
	const nearbyContext = sectionPointer?.content ?? "";
	if (settings.language === "zh-CN") {
		return [
			`公式路径: ${formulaPointer.sectionPath.join(" > ")}`,
			"上一次输出不合格，原因是它只剩公式本体、语言不一致，或缺少变量与作用解释。",
			"请重写为正式的中文公式讲解 Markdown。",
			"公式:",
			formulaPointer.content,
			"附近上下文:",
			nearbyContext,
			"无效输出:",
			previousOutput || "<empty>",
		].join("\n\n");
	}

	return [
		`Formula path: ${formulaPointer.sectionPath.join(" > ")}`,
		"The previous output was invalid because it reduced to the bare formula, used the wrong language, or omitted variable and role explanations.",
		"Rewrite it as formal English formula-explanation Markdown.",
		"Formula:",
		formulaPointer.content,
		"Nearby context:",
		nearbyContext,
		"Invalid output:",
		previousOutput || "<empty>",
	].join("\n\n");
}

async function repairSectionMarkdown(
	config: LlmConfig,
	plan: HighEffortPlannerResult["sectionPlans"][number],
	pointer: MarkdownContentPointer,
	settings: PaperAnalyzerSettings,
	signal: AbortSignal | undefined,
	invalidOutput: string
): Promise<string> {
	return callTextWithRetry(
		config,
		getSectionRepairPrompt(settings),
		buildSectionRepairUserContent(plan, pointer, settings, invalidOutput),
		signal,
		1100,
		0.1
	);
}

async function repairFormulaMarkdown(
	config: LlmConfig,
	formulaPointer: MarkdownContentPointer,
	sectionPointer: MarkdownContentPointer | undefined,
	settings: PaperAnalyzerSettings,
	signal: AbortSignal | undefined,
	invalidOutput: string
): Promise<string> {
	return callTextWithRetry(
		config,
		getFormulaRepairPrompt(settings),
		buildFormulaRepairUserContent(
			formulaPointer,
			sectionPointer,
			settings,
			invalidOutput
		),
		signal,
		950,
		0.1
	);
}

function initializeDraftSections(): Map<HighEffortTutorialHeadingKey, DraftSection> {
	return new Map(
		HEADING_ORDER.map((headingKey) => [
			headingKey,
			{
				headingKey,
				blocks: [],
				images: [],
			},
		])
	);
}

function mergeDraft(
	settings: PaperAnalyzerSettings,
	bundle: HighEffortSourceBundle,
	planner: HighEffortPlannerResult,
	sectionOutputs: HighEffortExplainerOutput[],
	formulaOutputs: HighEffortExplainerOutput[],
	revisionOutputs: Array<{ heading: HighEffortTutorialHeadingKey; markdown: string }>
): string {
	const headings = TUTORIAL_HEADINGS[settings.language];
	const pointerMap = buildPointerMap(bundle);
	const sections = initializeDraftSections();

	for (const output of sectionOutputs) {
		const section = sections.get(output.targetHeading);
		const pointer = pointerMap.get(output.pointerId);
		if (!section || !pointer) continue;
		section.blocks.push(renderExplainerBlock(pointerLabel(pointer), output.markdown));
		for (const imagePointerId of output.imagePointerIds) {
			if (
				!section.images.some((image) => image.pointerId === imagePointerId) &&
				output.figureNote
			) {
				section.images.push({ pointerId: imagePointerId, note: output.figureNote });
			}
		}
	}

	for (const formulaOutput of formulaOutputs) {
		const section = sections.get("formula_mechanism");
		const pointer = pointerMap.get(formulaOutput.pointerId);
		if (!section || !pointer) continue;
		section.blocks.push(renderExplainerBlock(pointerLabel(pointer), formulaOutput.markdown));
	}

	for (const revision of revisionOutputs) {
		const section = sections.get(revision.heading);
		if (!section) continue;
		section.blocks.push(revision.markdown.trim());
	}

	if (planner.narrativeFocus.length > 0) {
		const section = sections.get("core_intuition");
		if (section) {
			const lines = planner.narrativeFocus.map((entry) => `- ${entry}`).join("\n");
			section.blocks.unshift(
				settings.language === "zh-CN"
					? `> [!tip] 阅读主线\n${lines}`
					: `> [!tip] Reading map\n${lines}`
			);
		}
	}

	const fallbackText =
		settings.language === "zh-CN"
			? "当前检索到的内容不足以支撑这一节的完整讲解。"
			: "The retrieved source does not provide enough detail for a fuller explanation here.";

	return HEADING_ORDER.map((headingKey) => {
		const section = sections.get(headingKey);
		const blocks = section?.blocks.filter(Boolean) ?? [];
		const imageBlocks = (section?.images ?? [])
			.map((image) => {
				const pointer = pointerMap.get(image.pointerId);
				if (!pointer) return "";
				return `${image.note}\n\n${pointer.content}`;
			})
			.filter(Boolean);
		const body = [...blocks, ...imageBlocks].filter(Boolean).join("\n\n");
		return `## ${headings[headingKey]}\n${body || fallbackText}`;
	}).join("\n\n");
}

function normalizeRevisionRequests(
	raw: { revisionRequests?: unknown[] },
	bundle: HighEffortSourceBundle
): HighEffortRevisionRequest[] {
	const pointerMap = buildPointerMap(bundle);
	const headingSet = new Set<HighEffortTutorialHeadingKey>(HEADING_ORDER);
	const isHeadingKey = (value: unknown): value is HighEffortTutorialHeadingKey =>
		typeof value === "string" && headingSet.has(value as HighEffortTutorialHeadingKey);
	if (!Array.isArray(raw.revisionRequests)) return [];
	return raw.revisionRequests
		.map((entry) => {
			const record = entry as Partial<HighEffortRevisionRequest>;
			const pointerIds = Array.isArray(record.pointerIds)
				? record.pointerIds.filter(
					(pointerId): pointerId is string =>
						typeof pointerId === "string" && pointerMap.has(pointerId)
				)
				: [];
			if (pointerIds.length === 0) return null;
			const leadPointer = pointerMap.get(pointerIds[0] ?? "");
			if (!leadPointer) return null;
			const targetHeading = isHeadingKey(record.targetHeading)
				? record.targetHeading
				: inferHeadingFromPointer(leadPointer);
			const issue = normalizeWhitespace(record.issue || "");
			const instruction = normalizeWhitespace(record.instruction || "");
			if (!issue || !instruction) return null;
			return {
				pointerIds,
				targetHeading,
				issue,
				instruction,
			};
		})
		.filter((entry): entry is HighEffortRevisionRequest => !!entry)
		.slice(0, MAX_REVISION_REQUESTS);
}

export async function runHighEffortSummaryOrchestrator(
	options: HighEffortOrchestratorOptions
): Promise<string> {
	const progress = createProgressController(options.onProgress);
	const { settings, signal, config } = options;

	const sourcePhase = getPhaseMessage("source", "default");
	progress.report({
		...sourcePhase,
		activeWorkers: 0,
		pendingWorkers: 0,
	});
	const bundle = await buildHighEffortSourceBundle({
		app: options.app,
		pdfFile: options.pdfFile,
		paperTitle: options.pdfFile.basename,
		arxivId: options.arxivId,
		settings,
	});
	signal?.throwIfAborted();
	progress.advance();
	progress.report({
		phase: sourcePhase.phase,
		message: t("summaryStatus.highSourceResolved", { source: bundle.sourceLabel }),
		activeWorkers: 0,
		pendingWorkers: 0,
	});

	const plannerPhase = getPhaseMessage("planning", "default");
	progress.report({
		...plannerPhase,
		activeWorkers: 1,
		pendingWorkers: 0,
	});
	const planner = buildRuleBasedPlanner(bundle, settings.language);
	signal?.throwIfAborted();
	progress.addTotal(planner.sectionPlans.length + planner.formulaPointerIds.length);
	progress.advance();

	const pointerMap = buildPointerMap(bundle);
	const sectionPhaseName = t("summaryStatus.highSectionsPhase");
	const sectionOutputs = await runFanoutStage({
		items: planner.sectionPlans,
		concurrency: Math.min(settings.llmConcurrency, SECTION_STAGE_CONCURRENCY),
		phase: sectionPhaseName,
		buildMessage: (done, total, item) =>
			t("summaryStatus.highSectionsRunning", {
				done: String(Math.min(total, done + 1)),
				total: String(total),
				label:
					pointerLabel(pointerMap.get(item.pointerId) as MarkdownContentPointer) || item.goal,
			}),
		currentLabel: (item) =>
			pointerLabel(pointerMap.get(item.pointerId) as MarkdownContentPointer),
		runItem: async (plan) => {
			const pointer = pointerMap.get(plan.pointerId) as MarkdownContentPointer;
			const response = await callJsonWithRawText<Partial<HighEffortExplainerOutput>>(
				config,
				getSectionExplainerPrompt(settings),
				buildSectionUserContent(plan, pointer, settings),
				signal,
				1100
			);
			const primaryMarkdown =
				typeof response.parsed?.markdown === "string"
					? response.parsed.markdown
					: coerceRawMarkdownResponse(response.rawText);
			let output = normalizeExplainerOutput(
				pointer,
				plan.targetHeading,
				{
					...(response.parsed ?? {}),
					markdown: primaryMarkdown,
				},
				settings.language,
				bundle
			);

			if (isSectionExplanationInsufficient(output.markdown, pointer, settings.language)) {
				const repairedMarkdown = coerceRawMarkdownResponse(await repairSectionMarkdown(
					config,
					plan,
					pointer,
					settings,
					signal,
					output.markdown || response.rawText
				));
				output = normalizeExplainerOutput(
					pointer,
					plan.targetHeading,
					{
						...(response.parsed ?? {}),
						markdown: repairedMarkdown,
					},
					settings.language,
					bundle
				);
			}

			if (isSectionExplanationInsufficient(output.markdown, pointer, settings.language)) {
				output = {
					...output,
					markdown: buildSectionSafetyNetMarkdown(plan, pointer, settings.language),
				};
			}

			return output;
		},
		progress,
		signal,
	});
	signal?.throwIfAborted();
	progress.report({
		phase: sectionPhaseName,
		message: t("summaryStatus.highSectionsCompleted", {
			count: String(sectionOutputs.length),
		}),
		activeWorkers: 0,
		pendingWorkers: 0,
	});

	const formulaPointers = planner.formulaPointerIds
		.map((pointerId) => pointerMap.get(pointerId))
		.filter((pointer): pointer is MarkdownContentPointer => !!pointer);
	const formulaPhaseName = t("summaryStatus.highFormulasPhase");
	const formulaOutputs = await runFanoutStage({
		items: formulaPointers,
		concurrency: Math.min(settings.llmConcurrency, FORMULA_STAGE_CONCURRENCY),
		phase: formulaPhaseName,
		buildMessage: (done, total, item) =>
			t("summaryStatus.highFormulasRunning", {
				done: String(Math.min(total, done + 1)),
				total: String(total),
				label: pointerLabel(item),
			}),
		currentLabel: (item) => pointerLabel(item),
		runItem: async (pointer) => {
			const sectionPointer = findOwningSection(bundle, pointer);
			const response = await callJsonWithRawText<Partial<HighEffortExplainerOutput>>(
				config,
				getFormulaExplainerPrompt(settings),
				buildFormulaUserContent(pointer, sectionPointer, settings),
				signal,
				900
			);
			const primaryMarkdown =
				typeof response.parsed?.markdown === "string"
					? response.parsed.markdown
					: coerceRawMarkdownResponse(response.rawText);
			let output = normalizeExplainerOutput(
				pointer,
				"formula_mechanism",
				{
					...(response.parsed ?? {}),
					markdown: primaryMarkdown,
				},
				settings.language
			);

			if (isFormulaExplanationInsufficient(output.markdown, pointer, settings.language)) {
				const repairedMarkdown = coerceRawMarkdownResponse(await repairFormulaMarkdown(
					config,
					pointer,
					sectionPointer,
					settings,
					signal,
					output.markdown || response.rawText
				));
				output = normalizeExplainerOutput(
					pointer,
					"formula_mechanism",
					{
						...(response.parsed ?? {}),
						markdown: repairedMarkdown,
					},
					settings.language
				);
			}

			if (isFormulaExplanationInsufficient(output.markdown, pointer, settings.language)) {
				output = {
					...output,
					markdown: buildFormulaSafetyNetMarkdown(
						pointer,
						sectionPointer,
						settings.language
					),
				};
			}

			return output;
		},
		progress,
		signal,
	});
	signal?.throwIfAborted();
	progress.report({
		phase: formulaPhaseName,
		message: formulaOutputs.length
			? t("summaryStatus.highFormulasCompleted", { count: String(formulaOutputs.length) })
			: t("summaryStatus.highFormulasSkipped"),
		activeWorkers: 0,
		pendingWorkers: 0,
	});

	const mergePhase = getPhaseMessage("merge", "default");
	progress.report({
		...mergePhase,
		activeWorkers: 1,
		pendingWorkers: 0,
	});
	const initialDraft = mergeDraft(
		settings,
		bundle,
		planner,
		sectionOutputs,
		formulaOutputs,
		[]
	);
	progress.advance();

	const reviewPhaseName = t("summaryStatus.highReviewPhase");
	let revisionOutputs: Array<{ heading: HighEffortTutorialHeadingKey; markdown: string }> = [];
	if (settings.highEffortReviewEnabled) {
		progress.report({
			phase: reviewPhaseName,
			message: t("summaryStatus.highReviewMessage"),
			activeWorkers: 1,
			pendingWorkers: 0,
		});
		const reviewerRaw = await callJson<{ revisionRequests?: unknown[] }>(
			config,
			getReviewerPrompt(settings),
			buildReviewerUserContent(bundle, initialDraft, planner, settings),
			signal,
			{ revisionRequests: [] },
			1200,
			0.1
		);
		signal?.throwIfAborted();
		const revisions = normalizeRevisionRequests(reviewerRaw, bundle);
		progress.advance();
		progress.addTotal(revisions.length);
		if (revisions.length > 0) {
			revisionOutputs = await runFanoutStage({
				items: revisions,
				concurrency: Math.min(settings.llmConcurrency, REVIEW_STAGE_CONCURRENCY),
				phase: reviewPhaseName,
				buildMessage: (done, total, revision) =>
					t("summaryStatus.highReviewRunning", {
						done: String(Math.min(total, done + 1)),
						total: String(total),
						label: revision.issue,
					}),
				currentLabel: (revision) => revision.issue,
				runItem: async (revision) => {
					const revisionPointers = revision.pointerIds
						.map((pointerId) => pointerMap.get(pointerId))
						.filter((pointer): pointer is MarkdownContentPointer => !!pointer);
					const raw = await callJson<{ markdown?: string }>(
						config,
						getExpansionPrompt(settings),
						buildExpansionUserContent(revision, revisionPointers, settings),
						signal,
						{ markdown: revision.issue },
						850
					);
					return {
						heading: revision.targetHeading,
						markdown: raw.markdown?.trim() || revision.instruction,
					};
				},
				progress,
				signal,
			});
		}
	} else {
		progress.report({
			phase: reviewPhaseName,
			message: t("summaryStatus.highReviewDisabled"),
			activeWorkers: 0,
			pendingWorkers: 0,
		});
		progress.advance();
	}
	signal?.throwIfAborted();

	const renderPhase = getPhaseMessage("render", "default");
	progress.report({
		...renderPhase,
		activeWorkers: 1,
		pendingWorkers: 0,
	});
	const finalContent = mergeDraft(
		settings,
		bundle,
		planner,
		sectionOutputs,
		formulaOutputs,
		revisionOutputs
	);
	progress.advance();
	progress.report({
		phase: renderPhase.phase,
		message: renderPhase.message,
		activeWorkers: 0,
		pendingWorkers: 0,
	});
	return finalContent;
}