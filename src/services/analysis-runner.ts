import type { App, TFile } from "obsidian";
import type { PaperAnalyzerSettings } from "../settings";
import type { HighlightResult, PdfAnchor, LlmConfig } from "../types";
import type { PageData } from "./pdf-parser";
import { parsePdf } from "./pdf-parser";
import { chunkPages } from "./section-chunker";
import { callLlm } from "./llm-client";
import { getPromptForChunk, runConcurrent } from "./prompt-router";
import { buildAnchors } from "./pdf-anchor";

export interface AnalysisProgress {
	done: number;
	total: number;
	message: string;
}

export type ProgressCallback = (p: AnalysisProgress) => void;

export async function runAnalysis(
	app: App,
	pdfFile: TFile,
	settings: PaperAnalyzerSettings,
	onProgress?: ProgressCallback,
	signal?: AbortSignal
): Promise<PdfAnchor[]> {
	const pages: PageData[] = await parsePdf(app, pdfFile);
	const chunks = chunkPages(pages);

	if (chunks.length === 0) {
		throw new Error("No text content found in PDF. Check PDF quality.");
	}

	signal?.throwIfAborted();

	const config: LlmConfig = {
		baseUrl: settings.extractionBaseUrl,
		apiKey: settings.extractionApiKey,
		model: settings.extractionModel,
		provider: settings.extractionProvider,
		concurrencyLimit: settings.llmConcurrency,
	};

	let doneCount = 0;
	const allAnchors: PdfAnchor[] = [];

	const tasks = chunks.map((chunk) => async () => {
		signal?.throwIfAborted();
		const prompt = getPromptForChunk(chunk, settings);
		const results: HighlightResult[] = await callLlm(config, prompt, chunk, signal);
		signal?.throwIfAborted();
		const chunkAnchors = buildAnchors(results, pages, pdfFile.name);
		allAnchors.push(...chunkAnchors);
		doneCount++;
		onProgress?.({
			done: doneCount,
			total: chunks.length,
			message: `${chunk.headingText || chunk.sectionTag} (${chunk.text.length} chars) → ${results.length} highlights`,
		});
		return chunkAnchors;
	});

	await runConcurrent(tasks, settings.llmConcurrency, signal);

	return allAnchors;
}
