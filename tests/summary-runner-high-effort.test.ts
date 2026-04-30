import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/high-effort-summary-orchestrator", () => ({
	runHighEffortSummaryOrchestrator: vi.fn(),
}));

vi.mock("../src/services/llm-client", () => ({
	callLlmText: vi.fn(),
}));

vi.mock("../src/services/pdf-parser", () => ({
	parsePdf: vi.fn(),
}));

vi.mock("../src/services/summary-writer", () => ({
	writeSummaryBlock: vi.fn(),
}));

import { runSummary } from "../src/services/summary-runner";
import { runHighEffortSummaryOrchestrator } from "../src/services/high-effort-summary-orchestrator";
import { callLlmText } from "../src/services/llm-client";
import { parsePdf } from "../src/services/pdf-parser";
import { writeSummaryBlock } from "../src/services/summary-writer";

const baseSettings = {
	language: "en",
	summaryBaseUrl: "https://api.example.com/v1",
	summaryApiKey: "sk-test",
	summaryModel: "summary-model",
	summaryProvider: "openai",
	llmConcurrency: 3,
	summaryLowPrompt: "low prompt",
	summaryMediumPrompt: "medium prompt",
	summaryHighPrompt: "high prompt",
	summaryLowPromptZh: "低 prompt",
	summaryMediumPromptZh: "中 prompt",
	summaryHighPromptZh: "高 prompt",
	huggingFaceApiKey: "",
	preferHuggingFacePaperMarkdown: false,
	highEffortReviewEnabled: true,
} as const;

function makeApp() {
	return {
		metadataCache: {
			getFileCache: () => ({
				frontmatter: {
					arxiv_id: "2604.04184",
				},
			}),
		},
		vault: {
			read: vi.fn(),
			modify: vi.fn(),
		},
	} as never;
}

function makePdfFile() {
	return {
		basename: "AURA",
		name: "AURA.pdf",
		path: "Papers/PDFs/AURA.pdf",
		extension: "pdf",
	} as never;
}

function makeNoteFile() {
	return {
		basename: "AURA",
		name: "AURA.md",
		path: "Papers/Notes/AURA.md",
		extension: "md",
	} as never;
}

beforeEach(() => {
	vi.mocked(runHighEffortSummaryOrchestrator).mockReset();
	vi.mocked(callLlmText).mockReset();
	vi.mocked(parsePdf).mockReset();
	vi.mocked(writeSummaryBlock).mockReset();
});

describe("runSummary branching", () => {
	it("routes high effort through the multi-stage orchestrator", async () => {
		vi.mocked(runHighEffortSummaryOrchestrator).mockImplementationOnce(async ({ onProgress }) => {
			onProgress?.({
				phase: "Tutorial planning",
				message: "Explaining sections 2/4: Method",
				done: 6,
				total: 7,
				activeWorkers: 2,
				pendingWorkers: 1,
				currentPointerLabel: "Method",
			});
			return "High effort tutorial with $\\bm{\\tilde{v}_{i}}$";
		});

		const progressEvents: Array<{ phase: string; message: string; done: number; total: number }> = [];
		const app = makeApp();
		await runSummary(
			app,
			makePdfFile(),
			makeNoteFile(),
			baseSettings as never,
			"high",
			(progress) => progressEvents.push(progress),
			undefined
		);

		expect(runHighEffortSummaryOrchestrator).toHaveBeenCalledWith(
			expect.objectContaining({
				arxivId: "2604.04184",
				settings: baseSettings,
			})
		);
		expect(callLlmText).not.toHaveBeenCalled();
		expect(writeSummaryBlock).toHaveBeenCalledWith(
			app,
			expect.anything(),
			expect.objectContaining({ content: "High effort tutorial with $\\boldsymbol{\\tilde{v}_{i}}$", effort: "high" })
		);
		expect(progressEvents.at(-1)).toEqual(
			expect.objectContaining({ phase: "Summary done", done: 7, total: 7 })
		);
	});

	it("keeps low effort on the legacy single-pass path", async () => {
		vi.mocked(parsePdf).mockResolvedValueOnce([
			{
				pageNum: 1,
				items: [],
				fullText: "Loose text with no obvious heading.",
				styles: {},
			},
		] as never);
		vi.mocked(callLlmText).mockResolvedValueOnce("Compact summary");

		const app = makeApp();
		await runSummary(
			app,
			makePdfFile(),
			makeNoteFile(),
			baseSettings as never,
			"low"
		);

		expect(runHighEffortSummaryOrchestrator).not.toHaveBeenCalled();
		expect(callLlmText).toHaveBeenCalledTimes(1);
		expect(writeSummaryBlock).toHaveBeenCalledWith(
			app,
			expect.anything(),
			expect.objectContaining({ content: "Compact summary", effort: "low" })
		);
	});
});