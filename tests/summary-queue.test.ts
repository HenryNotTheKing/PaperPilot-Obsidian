import { describe, expect, it, vi, beforeEach } from "vitest";
import { TFile } from "obsidian";

vi.mock("../src/services/summary-runner", () => ({
	runSummary: vi.fn(),
}));

import { SummaryQueue } from "../src/services/summary-queue";
import { runSummary } from "../src/services/summary-runner";

function makeFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.split("/").pop() ?? path;
	const dotIndex = file.name.lastIndexOf(".");
	file.basename = dotIndex >= 0 ? file.name.slice(0, dotIndex) : file.name;
	file.extension = dotIndex >= 0 ? file.name.slice(dotIndex + 1) : "";
	return file;
}

function makePlugin(pdfFile: TFile, noteFile: TFile) {
	const files = new Map([
		[pdfFile.path, pdfFile],
		[noteFile.path, noteFile],
	]);

	return {
		settings: {
			summaryQueue: [],
			defaultSummaryEffort: "medium",
			notesFolderPath: "Papers/Notes",
			citationSidebar: {
				enabled: true,
				maxResults: 20,
				minSimilarity: 0.05,
				semanticScholarApiKey: "",
				arxivFieldAliases: ["arxiv_id", "arxiv"],
				doiFieldAliases: ["doi"],
			},
		},
		saveSettings: vi.fn(async () => {}),
		app: {
			workspace: {
				trigger: vi.fn(),
			},
			vault: {
				getAbstractFileByPath: (path: string) => files.get(path) ?? null,
			},
		},
	};
}

beforeEach(() => {
	vi.mocked(runSummary).mockReset();
});

describe("SummaryQueue", () => {
	it("keeps request ids and overload hints in queue errors", async () => {
		const pdfFile = makeFile("Papers/PDFs/test-paper.pdf");
		const noteFile = makeFile("Papers/Notes/test-paper.md");
		const plugin = makePlugin(pdfFile, noteFile);
		const overloadError = Object.assign(
			new Error(
				"LLM API returned 529: overloaded error (request id: req_summary_1)"
			),
			{
				status: 529,
				requestId: "req_summary_1",
				rawMessage: "overloaded error (529)",
				isRetryable: true,
				isOverloaded: true,
			}
		);
		vi.mocked(runSummary).mockRejectedValueOnce(overloadError);

		const queue = new SummaryQueue(plugin as never);
		await queue.enqueue(pdfFile, noteFile, "medium");

		await vi.waitFor(() => {
			expect(plugin.settings.summaryQueue[0]?.status).toBe("error");
		});

		expect(plugin.settings.summaryQueue[0]?.error).toContain(
			"request id: req_summary_1"
		);
		expect(plugin.settings.summaryQueue[0]?.error).toContain(
			"Concurrency reduced automatically"
		);
	});

	it("preserves detailed summary progress fields from the runner", async () => {
		const pdfFile = makeFile("Papers/PDFs/test-paper.pdf");
		const noteFile = makeFile("Papers/Notes/test-paper.md");
		const plugin = makePlugin(pdfFile, noteFile);
		let resolveRun!: () => void;
		const runSummaryPromise = new Promise<void>((resolve) => {
			resolveRun = resolve;
		});
		vi.mocked(runSummary).mockImplementationOnce(async (_app, _pdf, _note, _settings, _effort, onProgress) => {
			onProgress?.({
				phase: "Section explainers",
				message: "Explaining sections 2/5: Method",
				done: 3,
				total: 8,
				activeWorkers: 2,
				pendingWorkers: 1,
				currentPointerLabel: "Method",
			});
			await runSummaryPromise;
			return "ok";
		});

		const queue = new SummaryQueue(plugin as never);
		await queue.enqueue(pdfFile, noteFile, "high");

		await vi.waitFor(() => {
			expect(plugin.settings.summaryQueue[0]?.progress).toEqual(
				expect.objectContaining({
					phase: "Section explainers",
					message: "Explaining sections 2/5: Method",
					activeWorkers: 2,
					pendingWorkers: 1,
					currentPointerLabel: "Method",
				})
			);
		});

		resolveRun();
		await vi.waitFor(() => {
			expect(plugin.settings.summaryQueue[0]?.status).toBe("done");
		});

		expect(plugin.app.workspace.trigger).toHaveBeenCalledWith("paper-analyzer:queue-update");
	});
});