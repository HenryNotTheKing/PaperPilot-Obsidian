import { Notice, TFile } from "obsidian";
import type PaperAnalyzerPlugin from "../main";
import type { QueueItem, StoredHighlight } from "../types";
import { runAnalysis } from "./analysis-runner";
import { formatLlmErrorForDisplay } from "./llm-client";
import { t } from "../i18n";

export class AnalyzeQueue {
	private isProcessing = false;
	private runningAbortController: AbortController | null = null;

	constructor(private plugin: PaperAnalyzerPlugin) {}

	async enqueue(pdfFile: TFile): Promise<void> {
		const alreadyQueued = this.plugin.settings.analyzeQueue.some(
			(i) =>
				i.pdfFile === pdfFile.path &&
				(i.status === "pending" || i.status === "running")
		);
		if (alreadyQueued) return;

		const hadExistingHighlights =
			(this.plugin.settings.highlights?.[pdfFile.path]?.length ?? 0) > 0;
		if (hadExistingHighlights) {
			delete this.plugin.settings.highlights[pdfFile.path];
		}

		const item: QueueItem = {
			id: Math.random().toString(36).slice(2, 10),
			pdfFile: pdfFile.path,
			status: "pending",
			addedAt: Date.now(),
		};
		this.plugin.settings.analyzeQueue.push(item);
		await this.plugin.saveSettings();
		if (hadExistingHighlights) {
			this.plugin.rerenderPdfHighlights();
			new Notice(
				t("notices.clearedOldHighlights", { basename: pdfFile.basename })
			);
		}
		this.plugin.app.workspace.trigger("paper-analyzer:queue-update");
		void this.processNext();
	}

	async processNext(): Promise<void> {
		if (this.isProcessing) return;
		const item = this.plugin.settings.analyzeQueue.find(
			(i) => i.status === "pending"
		);
		if (!item) return;

		this.isProcessing = true;
		item.status = "running";
		item.startedAt = Date.now();
		await this.plugin.saveSettings();
		this.plugin.app.workspace.trigger("paper-analyzer:queue-update");

		this.runningAbortController = new AbortController();

		try {
			const pdfFile = this.plugin.app.vault.getAbstractFileByPath(item.pdfFile);
			if (!(pdfFile instanceof TFile)) {
				throw new Error(`File not found: ${item.pdfFile}`);
			}
			await runAnalysis(
				this.plugin.app,
				pdfFile,
				this.plugin.settings,
				(p) => {
					item.progress = { done: p.done, total: p.total };
					this.plugin.app.workspace.trigger("paper-analyzer:queue-update");
				},
				this.runningAbortController.signal
			).then(async (anchors) => {
				// Persist highlight index data so the PDF viewer can render overlays
				const highlights: StoredHighlight[] = anchors
					.filter((a) => a.beginIndex !== undefined && a.endIndex !== undefined)
					.map((a) => ({
						exact_text: a.exact_text,
						type: a.type,
						pageNum: a.matchPageNum ?? 1,
						beginIndex: a.beginIndex!,
						beginOffset: a.beginOffset ?? 0,
						endIndex: a.endIndex!,
						endOffset: a.endOffset ?? 0,
					}));
				if (highlights.length > 0) {
					this.plugin.settings.highlights ??= {};
					this.plugin.settings.highlights[item.pdfFile] = highlights;
					// Immediately mount overlays on any open PDF viewer for this file
					void this.plugin.refreshPdfHighlights();
				}
			});
			item.status = "done";
			new Notice(t("notices.analysisComplete", { basename: pdfFile.basename }));
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			item.status = "error";
			const isAbort =
				(err instanceof DOMException && err.name === "AbortError") ||
				msg.toLowerCase().includes("abort");
			item.error = isAbort ? "Cancelled" : formatLlmErrorForDisplay(err);
		} finally {
			item.progress = undefined;
			this.runningAbortController = null;
			this.isProcessing = false;
			await this.plugin.saveSettings();
			this.plugin.app.workspace.trigger("paper-analyzer:queue-update");
			void this.processNext();
		}
	}

	cancel(): void {
		this.runningAbortController?.abort();
	}

	getQueue(): QueueItem[] {
		return this.plugin.settings.analyzeQueue;
	}

	async clearDone(): Promise<void> {
		this.plugin.settings.analyzeQueue =
			this.plugin.settings.analyzeQueue.filter(
				(i) => i.status === "pending" || i.status === "running"
			);
		await this.plugin.saveSettings();
		this.plugin.app.workspace.trigger("paper-analyzer:queue-update");
	}
}
