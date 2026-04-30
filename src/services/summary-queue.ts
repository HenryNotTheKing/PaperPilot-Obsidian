import { Notice, TFile } from "obsidian";
import type PaperAnalyzerPlugin from "../main";
import type { SummaryEffort, SummaryQueueItem } from "../types";
import { t } from "../i18n";
import { formatLlmErrorForDisplay } from "./llm-client";
import { resolvePaperContext } from "./paper-identity-resolver";
import { runSummary } from "./summary-runner";

export class SummaryQueue {
	private isProcessing = false;
	private runningAbortController: AbortController | null = null;

	constructor(private plugin: PaperAnalyzerPlugin) {}

	async enqueue(
		pdfFile: TFile,
		noteFile?: TFile,
		effort: SummaryEffort = this.plugin.settings.defaultSummaryEffort
	): Promise<void> {
		const alreadyQueued = this.plugin.settings.summaryQueue.some(
			(item) =>
				item.pdfFile === pdfFile.path &&
				item.effort === effort &&
				(item.status === "pending" || item.status === "running")
		);
		if (alreadyQueued) return;

		const item: SummaryQueueItem = {
			id: Math.random().toString(36).slice(2, 10),
			noteFile: noteFile?.path,
			pdfFile: pdfFile.path,
			effort,
			status: "pending",
			addedAt: Date.now(),
		};
		this.plugin.settings.summaryQueue.push(item);
		await this.plugin.saveSettings();
		this.plugin.app.workspace.trigger("paper-analyzer:queue-update");
		void this.processNext();
	}

	async processNext(): Promise<void> {
		if (this.isProcessing) return;
		const item = this.plugin.settings.summaryQueue.find(
			(queueItem) => queueItem.status === "pending"
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

			const noteFile = await this.resolveNoteFile(item, pdfFile);
			await runSummary(
				this.plugin.app,
				pdfFile,
				noteFile,
				this.plugin.settings,
				item.effort,
				(progress) => {
					item.progress = {
						phase: progress.phase,
						message: progress.message,
						done: progress.done,
						total: progress.total,
						activeWorkers: progress.activeWorkers,
						pendingWorkers: progress.pendingWorkers,
						currentPointerLabel: progress.currentPointerLabel,
					};
					this.plugin.app.workspace.trigger("paper-analyzer:queue-update");
				},
				this.runningAbortController.signal
			);
			item.status = "done";
			new Notice(t("notices.summaryComplete", { basename: noteFile.basename }));
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

	getQueue(): SummaryQueueItem[] {
		return this.plugin.settings.summaryQueue;
	}

	async clearDone(): Promise<void> {
		this.plugin.settings.summaryQueue = this.plugin.settings.summaryQueue.filter(
			(item) => item.status === "pending" || item.status === "running"
		);
		await this.plugin.saveSettings();
		this.plugin.app.workspace.trigger("paper-analyzer:queue-update");
	}

	private async resolveNoteFile(
		item: SummaryQueueItem,
		pdfFile: TFile
	): Promise<TFile> {
		if (item.noteFile) {
			const noteFile = this.plugin.app.vault.getAbstractFileByPath(item.noteFile);
			if (noteFile instanceof TFile) return noteFile;
		}

		const resolved = await resolvePaperContext(this.plugin.app, pdfFile, {
			notesFolderPath: this.plugin.settings.notesFolderPath,
			citationSidebar: this.plugin.settings.citationSidebar,
		});
		if (resolved?.relatedNote instanceof TFile) {
			item.noteFile = resolved.relatedNote.path;
			return resolved.relatedNote;
		}

		throw new Error(t("notices.summaryNoteNotFound", { path: pdfFile.path }));
	}
}