import type { App, TFile } from "obsidian";
import type { PaperAnalyzerSettings } from "../settings";
import type {
	LlmConfig,
	SectionTag,
	SummaryEffort,
	SummaryQueueProgress,
	TextChunk,
} from "../types";
import { t } from "../i18n";
import { extractArxivId } from "./arxiv-client";
import {
	fetchPaperMarkdownFromHuggingFace,
	truncateHuggingFacePaperMarkdown,
} from "./huggingface-paper-client";
import { runHighEffortSummaryOrchestrator } from "./high-effort-summary-orchestrator";
import { callLlmText } from "./llm-client";
import {
	chunkMarkdownByHeadings,
	type MarkdownSectionChunk,
} from "./markdown-section-chunker";
import { sanitizeMarkdownForObsidian } from "./obsidian-markdown-utils";
import { parsePdf, type PageData } from "./pdf-parser";
import { chunkPages } from "./section-chunker";
import { writeSummaryBlock } from "./summary-writer";

const SECTION_PRIORITY_BY_EFFORT: Record<SummaryEffort, SectionTag[]> = {
	low: ["abstract", "introduction", "conclusion", "experiment", "method", "other"],
	medium: [
		"abstract",
		"introduction",
		"method",
		"experiment",
		"conclusion",
		"related_work",
		"other",
	],
	high: [
		"abstract",
		"introduction",
		"method",
		"experiment",
		"conclusion",
		"related_work",
		"other",
	],
	extream: [
		"abstract",
		"introduction",
		"method",
		"experiment",
		"conclusion",
		"related_work",
		"other",
	],
};

const CONTEXT_LIMITS: Record<SummaryEffort, number> = {
	low: 6000,
	medium: 12000,
	high: 18000,
	extream: 24000,
};

const CHUNK_LIMITS: Record<SummaryEffort, number> = {
	low: 5,
	medium: 10,
	high: 16,
	extream: 20,
};

const MARKDOWN_CHUNK_LIMITS: Record<SummaryEffort, number> = {
	low: 6,
	medium: 12,
	high: 18,
	extream: 24,
};

const MAX_OUTPUT_TOKENS: Record<SummaryEffort, number> = {
	low: 900,
	medium: 1500,
	high: 2200,
	extream: 2800,
};

export type SummaryProgress = SummaryQueueProgress;

export type SummaryProgressCallback = (progress: SummaryQueueProgress) => void;

function getSummaryPrompt(
	settings: PaperAnalyzerSettings,
	effort: SummaryEffort
): string {
	const isChinese = settings.language === "zh-CN";
	switch (effort) {
		case "low":
			return isChinese ? settings.summaryLowPromptZh : settings.summaryLowPrompt;
		case "extream":
			return isChinese
				? settings.summaryExtreamPromptZh
				: settings.summaryExtreamPrompt;
		case "high":
			return isChinese ? settings.summaryHighPromptZh : settings.summaryHighPrompt;
		case "medium":
		default:
			return isChinese ? settings.summaryMediumPromptZh : settings.summaryMediumPrompt;
	}
}

function getSummaryConfig(settings: PaperAnalyzerSettings): LlmConfig {
	return {
		baseUrl: settings.summaryBaseUrl,
		apiKey: settings.summaryApiKey,
		model: settings.summaryModel,
		provider: settings.summaryProvider,
		concurrencyLimit: settings.llmConcurrency,
	};
}

function truncateText(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	const truncated = value.slice(0, maxChars);
	const lastBoundary = Math.max(
		truncated.lastIndexOf("\n\n"),
		truncated.lastIndexOf(". "),
		truncated.lastIndexOf("\n")
	);
	if (lastBoundary > Math.floor(maxChars * 0.6)) {
		return `${truncated.slice(0, lastBoundary).trim()}\n\n[Truncated for summary context]`;
	}
	return `${truncated.trim()}\n\n[Truncated for summary context]`;
}

function formatChunk(chunk: TextChunk): string {
	const label = chunk.headingText || chunk.sectionTag;
	return `### ${label}\n${chunk.text.trim()}`;
}

function inferMarkdownSectionTag(chunk: MarkdownSectionChunk): SectionTag {
	const text = chunk.path.join(" ").toLowerCase();
	if (/(^|\s)(abstract|摘要)(\s|$)/.test(text)) return "abstract";
	if (/(^|\s)(introduction|motivation|背景|研究动机)(\s|$)/.test(text)) return "introduction";
	if (/(related work|相关工作|prior work|literature review)/.test(text)) return "related_work";
	if (/(method|approach|framework|architecture|algorithm|方法|模型|框架|机制)/.test(text)) {
		return "method";
	}
	if (/(experiment|evaluation|results|implementation|ablation|实验|结果|实现细节|评估)/.test(text)) {
		return "experiment";
	}
	if (/(conclusion|discussion|limitations|结论|局限|总结)/.test(text)) return "conclusion";
	return "other";
}

function formatMarkdownChunk(chunk: MarkdownSectionChunk): string {
	const label = chunk.path.join(" > ");
	return `## ${label}\n${chunk.content.trim()}`;
}

function selectSummaryChunks(
	chunks: TextChunk[],
	effort: SummaryEffort
): TextChunk[] {
	const priority = SECTION_PRIORITY_BY_EFFORT[effort];
	const chunkLimit = CHUNK_LIMITS[effort];
	const selected: TextChunk[] = [];
	for (const section of priority) {
		for (const chunk of chunks) {
			if (chunk.sectionTag !== section) continue;
			if (selected.includes(chunk)) continue;
			selected.push(chunk);
			if (selected.length >= chunkLimit) return selected;
		}
	}
	return selected.slice(0, chunkLimit);
}

function selectMarkdownSummaryChunks(
	chunks: MarkdownSectionChunk[],
	effort: SummaryEffort
): MarkdownSectionChunk[] {
	const priority = SECTION_PRIORITY_BY_EFFORT[effort];
	const chunkLimit = MARKDOWN_CHUNK_LIMITS[effort];
	const selected: MarkdownSectionChunk[] = [];
	for (const section of priority) {
		for (const chunk of chunks) {
			if (inferMarkdownSectionTag(chunk) !== section) continue;
			if (selected.includes(chunk)) continue;
			selected.push(chunk);
			if (selected.length >= chunkLimit) return selected;
		}
	}
	return selected.slice(0, chunkLimit);
}

export function buildSummarySourceText(
	pdfFile: Pick<TFile, "basename">,
	pages: PageData[],
	effort: SummaryEffort
): string {
	const chunks = chunkPages(pages);
	if (chunks.length === 0) {
		const fallbackText = pages.map((page) => page.fullText).join("\n\n").trim();
		return truncateText(
			`# ${pdfFile.basename}\n\n${fallbackText}`,
			CONTEXT_LIMITS[effort]
		);
	}

	const selected = selectSummaryChunks(chunks, effort);
	const joined = selected.map(formatChunk).join("\n\n");
	return truncateText(`# ${pdfFile.basename}\n\n${joined}`, CONTEXT_LIMITS[effort]);
}

export function buildSummarySourceTextFromMarkdown(
	paperTitle: string,
	markdown: string,
	effort: SummaryEffort
): string {
	const chunks = chunkMarkdownByHeadings(markdown);
	if (chunks.length === 0) {
		return truncateHuggingFacePaperMarkdown(`# ${paperTitle}\n\n${markdown}`, effort);
	}

	const selected = selectMarkdownSummaryChunks(chunks, effort);
	const joined = selected.map(formatMarkdownChunk).join("\n\n");
	return truncateHuggingFacePaperMarkdown(`# ${paperTitle}\n\n${joined}`, effort);
}

function resolveArxivIdFromNote(app: App, noteFile: TFile): string | null {
	const cache = app.metadataCache.getFileCache(noteFile) as
		| { frontmatter?: Record<string, unknown> }
		| undefined;
	const frontmatter = cache?.frontmatter;
	const candidates = [
		frontmatter?.arxiv_id,
		frontmatter?.arxiv,
		frontmatter?.source,
		noteFile.basename,
	];

	for (const candidate of candidates) {
		if (typeof candidate !== "string") continue;
		const arxivId = extractArxivId(candidate);
		if (arxivId) return arxivId;
	}

	return null;
}

async function buildSummarySourceFromPreferredContent(
	app: App,
	pdfFile: TFile,
	noteFile: TFile,
	settings: PaperAnalyzerSettings,
	effort: SummaryEffort
): Promise<string> {
	if (settings.preferHuggingFacePaperMarkdown) {
		const arxivId = resolveArxivIdFromNote(app, noteFile);
		if (arxivId) {
			const markdown = await fetchPaperMarkdownFromHuggingFace(arxivId, settings);
			if (markdown) {
				return buildSummarySourceTextFromMarkdown(pdfFile.basename, markdown, effort);
			}
		}
	}

	const pages = await parsePdf(app, pdfFile);
	return buildSummarySourceText(pdfFile, pages, effort);
}

function buildSummaryUserContent(
	pdfFile: Pick<TFile, "basename">,
	noteFile: Pick<TFile, "basename">,
	sourceText: string,
	effort: SummaryEffort,
	language: PaperAnalyzerSettings["language"]
): string {
	if (language === "zh-CN") {
		return [
			`论文文件: ${pdfFile.basename}`,
			`目标笔记: ${noteFile.basename}`,
			`总结强度: ${effort}`,
			"输出纯 Markdown，不要包裹代码块。",
			"不要输出思考过程、<think> 标签或逐步推理，直接给出最终答案。",
			"输出语言：简体中文。必要时可以保留论文中的英文术语。",
			"只使用提供的论文内容；如果某个信息不清楚，请明确说明，不要猜测。",
			"论文上下文:",
			sourceText,
		].join("\n\n");
	}

	return [
		`Paper file: ${pdfFile.basename}`,
		`Target note: ${noteFile.basename}`,
		`Effort level: ${effort}`,
		"Return Markdown only. Do not wrap the answer in code fences.",
		"Do not output chain-of-thought, <think> tags, or step-by-step reasoning. Write the final answer directly.",
		"Output language: English.",
		"Use only the provided paper content. If something is unclear, say so explicitly instead of guessing.",
		"Paper context:",
		sourceText,
	].join("\n\n");
}

export async function runSummary(
	app: App,
	pdfFile: TFile,
	noteFile: TFile,
	settings: PaperAnalyzerSettings,
	effort: SummaryEffort,
	onProgress?: SummaryProgressCallback,
	signal?: AbortSignal
): Promise<string> {
	const config = getSummaryConfig(settings);
	let latestDone = 2;
	let latestTotal = 3;
	const reportProgress = (progress: SummaryQueueProgress) => {
		latestDone = progress.done;
		latestTotal = progress.total;
		onProgress?.(progress);
	};

	let content = "";
	if (effort === "high" || effort === "extream") {
		content = await runHighEffortSummaryOrchestrator({
			app,
			pdfFile,
			noteFile,
			arxivId: resolveArxivIdFromNote(app, noteFile),
			settings,
			config,
			onProgress: reportProgress,
			signal,
		});
	} else {
		reportProgress({
			phase: t("summaryStatus.parsing"),
			message: t("summaryStatus.parsingDesc"),
			done: 0,
			total: 3,
			activeWorkers: 0,
			pendingWorkers: 0,
		});
		const sourceText = await buildSummarySourceFromPreferredContent(
			app,
			pdfFile,
			noteFile,
			settings,
			effort
		);
		signal?.throwIfAborted();
		const prompt = getSummaryPrompt(settings, effort);

		reportProgress({
			phase: t("summaryStatus.generating"),
			message: t("summaryStatus.generatingDesc"),
			done: 1,
			total: 3,
			activeWorkers: 1,
			pendingWorkers: 0,
		});
		content = await callLlmText(
			config,
			prompt,
			buildSummaryUserContent(pdfFile, noteFile, sourceText, effort, settings.language),
			signal,
			{
				responseMode: "text",
				maxTokens: MAX_OUTPUT_TOKENS[effort],
				temperature: 0.1,
			}
		);
	}
	signal?.throwIfAborted();

	reportProgress({
		phase: t("summaryStatus.writing"),
		message: t("summaryStatus.writingDesc"),
		done: latestDone,
		total: latestTotal,
		activeWorkers: 1,
		pendingWorkers: 0,
	});
	const sanitizedContent = sanitizeMarkdownForObsidian(content);
	await writeSummaryBlock(app, noteFile, {
		effort,
		model: settings.summaryModel,
		content: sanitizedContent,
		generatedAt: new Date().toISOString(),
		locale: settings.language,
	});

	reportProgress({
		phase: t("summaryStatus.done"),
		message: t("summaryStatus.doneDesc"),
		done: latestTotal,
		total: latestTotal,
		activeWorkers: 0,
		pendingWorkers: 0,
	});
	return sanitizedContent;
}