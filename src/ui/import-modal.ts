import { App, ButtonComponent, EventRef, Modal, Notice, Setting, TFile } from "obsidian";
import type PaperAnalyzerPlugin from "../main";
import type { ArxivMeta, QueueItem, SummaryQueueItem } from "../types";
import {
	extractArxivId,
	fetchArxivMeta,
	findExistingPdfFile,
	findExistingPaperNote,
	downloadPdf,
	createPaperNote,
} from "../services/arxiv-client";
import { runConcurrent } from "../services/prompt-router";
import { t } from "../i18n";

interface DuplicateResourceModalOptions {
	heading: string;
	description: string;
	keepButtonText: string;
	overwriteButtonText: string;
}

interface ImportRow {
	url: string;
	status: "idle" | "running" | "done" | "error";
	stepsDone: number; // 0=none 1=metadata 2=pdf 3=note
	title?: string;
	error?: string;
	noteFile?: TFile;
	pdfFile?: TFile;
}

const STEP_LABELS = [
	"",
	"stepFetchingMetadata",
	"stepDownloadingPdf",
	"stepCreatingNote",
];

function stepLabel(key: string): string {
	return t(`importModal.${key}`);
}

class DuplicateResourceModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private readonly options: DuplicateResourceModalOptions,
		private readonly onResolve: (shouldRedownload: boolean) => void
	) {
		super(app);
	}

	static open(
		app: App,
		options: DuplicateResourceModalOptions
	): Promise<boolean> {
		return new Promise((resolve) => {
			new DuplicateResourceModal(app, options, resolve).open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("paper-analyzer-modal");
		contentEl.addClass("paper-analyzer-modal--duplicate");

		new Setting(contentEl).setName(this.options.heading).setHeading();

		const noteEl = contentEl.createDiv({
			cls: "paper-analyzer-modal-note paper-analyzer-surface paper-analyzer-surface--quiet",
		});
		noteEl.createEl("p", {
			text: this.options.description,
			cls: "setting-item-description",
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText(this.options.keepButtonText)
					.setCta()
					.onClick(() => {
						this.resolve(false);
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText(this.options.overwriteButtonText)
					.setWarning()
					.onClick(() => {
						this.resolve(true);
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) {
			this.onResolve(false);
		}
	}

	private resolve(shouldRedownload: boolean): void {
		if (this.resolved) return;
		this.resolved = true;
		this.onResolve(shouldRedownload);
		this.close();
	}
}

export class ImportModal extends Modal {
	private plugin: PaperAnalyzerPlugin;
	private rows: ImportRow[] = [{ url: "", status: "idle", stepsDone: 0 }];
	private rowsEl: HTMLElement | null = null;
	private progressEl: HTMLElement | null = null;
	private importing = false;
	private duplicatePromptQueue: Promise<void> = Promise.resolve();
	private queueEventRef: EventRef | null = null;

	constructor(app: App, plugin: PaperAnalyzerPlugin, initialUrls?: string[]) {
		super(app);
		this.plugin = plugin;
		if (initialUrls?.length) {
			this.rows = initialUrls.map((url) => ({
				url,
				status: "idle" as const,
				stepsDone: 0,
			}));
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("paper-analyzer-modal");
		contentEl.addClass("paper-analyzer-modal--import");
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		new Setting(contentEl).setName(t("importModal.heading")).setHeading();

		// URL input rows
		this.rowsEl = contentEl.createDiv({
			cls: "paper-analyzer-url-rows paper-analyzer-surface paper-analyzer-surface--quiet",
		});
		this.renderRows();

		// Auto-analyze toggle
			const autoAnalyzeSetting = new Setting(contentEl)
			.setName(t("importModal.autoAnalyze"))
			.setDesc(t("importModal.autoAnalyzeDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoAnalyzeAfterImport)
					.onChange(async (value) => {
						this.plugin.settings.autoAnalyzeAfterImport = value;
						await this.plugin.saveSettings();
					})
			);
			autoAnalyzeSetting.settingEl.addClass("paper-analyzer-import-setting");

			const autoSummarizeSetting = new Setting(contentEl)
			.setName(t("importModal.autoSummarize"))
			.setDesc(t("importModal.autoSummarizeDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoSummarizeAfterImport)
					.onChange(async (value) => {
						this.plugin.settings.autoSummarizeAfterImport = value;
						await this.plugin.saveSettings();
					})
			);
			autoSummarizeSetting.settingEl.addClass("paper-analyzer-import-setting");

			// Import button
			const actionsEl = contentEl.createDiv({ cls: "paper-analyzer-import-actions" });
			new ButtonComponent(actionsEl)
				.setButtonText(t("importModal.importButton"))
				.setCta()
				.onClick(() => {
					if (!this.importing) void this.runImport();
				});

		// Per-row progress area
		this.progressEl = contentEl.createDiv({ cls: "paper-analyzer-import-progress" });
		this.queueEventRef = this.app.workspace.on("paper-analyzer:queue-update", () => {
			this.renderProgress();
		});
	}

	onClose(): void {
		if (this.queueEventRef) {
			this.app.workspace.offref(this.queueEventRef);
			this.queueEventRef = null;
		}
		this.contentEl.empty();
	}

	private renderRows(): void {
		if (!this.rowsEl) return;
		this.rowsEl.empty();

		this.rows.forEach((row, idx) => {
			const rowEl = this.rowsEl!.createDiv({ cls: "paper-analyzer-url-row" });
			const input = rowEl.createEl("input", {
				type: "text",
				placeholder: t("importModal.placeholder"),
				cls: "paper-analyzer-url-input",
			});
			input.value = row.url;
			input.addEventListener("input", () => {
				this.rows[idx]!.url = input.value;
			});
			input.addEventListener("keydown", (e: KeyboardEvent) => {
				if (e.key === "Enter" && !this.importing) void this.runImport();
			});

			// Remove button (only if more than one row)
			if (this.rows.length > 1) {
				const removeBtn = rowEl.createEl("button", {
					text: "×",
					cls: "paper-analyzer-url-remove",
				});
				removeBtn.addEventListener("click", () => {
					this.rows.splice(idx, 1);
					this.renderRows();
				});
			}
		});

		// Add row button
		const addBtn = this.rowsEl.createEl("button", {
			text: t("importModal.addRow"),
			cls: "paper-analyzer-url-add",
		});
		addBtn.addEventListener("click", () => {
			this.rows.push({ url: "", status: "idle", stepsDone: 0 });
			this.renderRows();
			// Focus the new input
			const inputs = this.rowsEl?.querySelectorAll("input");
			inputs?.[inputs.length - 1]?.focus();
		});
	}

	private renderProgress(): void {
		if (!this.progressEl) return;
		this.progressEl.empty();

		for (const row of this.rows) {
			if (row.status === "idle") continue;

			const rowEl = this.progressEl.createDiv({ cls: "paper-analyzer-import-row" });

			if (row.status === "error") {
				rowEl.createEl("p", {
					text: `❌ ${row.error ?? t("common.error")}`,
					cls: "paper-analyzer-import-row-error",
				});
				continue;
			}

			// Title or URL as label
			rowEl.createEl("p", {
				text: row.title
					? row.title.slice(0, 60)
					: row.url.slice(0, 60),
				cls: "paper-analyzer-import-row-title",
			});

			// Progress bar
			const bar = rowEl.createDiv({ cls: "paper-analyzer-progress-bar" });
			const fill = bar.createDiv({ cls: "paper-analyzer-progress-fill" });
			fill.style.width = `${(row.stepsDone / 3) * 100}%`;

			// Step label
			rowEl.createEl("small", {
				text: row.status === "done" ? t("common.done") + " ✅" : stepLabel(STEP_LABELS[row.stepsDone] ?? ""),
				cls: "paper-analyzer-import-row-step",
			});

			this.renderTaskProgress(rowEl, row, "highlight");
			this.renderTaskProgress(rowEl, row, "summary");
		}
	}

	private renderTaskProgress(
		rowEl: HTMLElement,
		row: ImportRow,
		taskType: "highlight" | "summary"
	): void {
		const queueItem =
			taskType === "highlight"
				? this.findLatestAnalyzeItem(row.pdfFile)
				: this.findLatestSummaryItem(row.pdfFile, row.noteFile);

		const shouldExpectTask =
			taskType === "highlight"
				? this.plugin.settings.autoAnalyzeAfterImport
				: this.plugin.settings.autoSummarizeAfterImport;

		if (!queueItem && !(shouldExpectTask && row.stepsDone >= 3)) {
			if (!shouldExpectTask || row.status === "idle") return;
			if (row.stepsDone < 3) {
				const waitingEl = rowEl.createDiv({ cls: "paper-analyzer-import-task" });
				waitingEl.createEl("p", {
					text: `${t(taskType === "highlight" ? "importModal.taskHighlight" : "importModal.taskSummary")} · ${t("importModal.taskWaiting")}`,
					cls: "paper-analyzer-import-task-title",
				});
			}
			return;
		}

		const taskEl = rowEl.createDiv({ cls: "paper-analyzer-import-task" });
		const labelKey = taskType === "highlight" ? "importModal.taskHighlight" : "importModal.taskSummary";
		const statusText = queueItem
			? this.getTaskStatusText(queueItem.status, this.getTaskProgressLabel(queueItem))
			: t("importModal.taskQueued");
		taskEl.createEl("p", {
			text: `${t(labelKey)} · ${statusText}`,
			cls: "paper-analyzer-import-task-title",
		});
		const bar = taskEl.createDiv({ cls: "paper-analyzer-progress-bar paper-analyzer-progress-bar--task" });
		const fill = bar.createDiv({ cls: "paper-analyzer-progress-fill" });

		if (!queueItem) {
			fill.addClass("paper-analyzer-progress-fill--running");
			return;
		}

		const total = queueItem.progress?.total ?? 0;
		const doneCount = queueItem.progress?.done ?? 0;
		if (queueItem.status === "done") {
			fill.style.width = "100%";
		} else if (total > 0) {
			fill.style.width = `${Math.round((doneCount / total) * 100)}%`;
		} else if (queueItem.status === "running" || queueItem.status === "pending") {
			fill.addClass("paper-analyzer-progress-fill--running");
		}

		if (queueItem.status === "error") {
			taskEl.createEl("small", {
				text: queueItem.error ?? t("common.error"),
				cls: "paper-analyzer-import-row-error",
			});
		}
	}

	private getTaskStatusText(
		status: "pending" | "running" | "done" | "error",
		progressLabel?: string
	): string {
		if (status === "done") return t("importModal.taskDone");
		if (status === "error") return t("common.error");
		if (status === "pending") return t("importModal.taskQueued");
		return progressLabel
			? `${t("importModal.taskRunning")} · ${progressLabel}`
			: t("importModal.taskRunning");
	}

	private getTaskProgressLabel(queueItem: QueueItem | SummaryQueueItem): string | undefined {
		const progress = queueItem.progress as
			| { done: number; total: number }
			| { phase?: string; message?: string; done?: number; total?: number }
			| undefined;
		if (!progress || !("message" in progress || "phase" in progress)) return undefined;
		const message = "message" in progress ? progress.message?.trim() : "";
		const phase = "phase" in progress ? progress.phase?.trim() : "";
		return message || phase || undefined;
	}

	private findLatestAnalyzeItem(pdfFile?: TFile): QueueItem | undefined {
		if (!pdfFile) return undefined;
		const items = this.plugin.settings.analyzeQueue.filter(
			(item) => item.pdfFile === pdfFile.path
		);
		return items[items.length - 1];
	}

	private findLatestSummaryItem(
		pdfFile?: TFile,
		noteFile?: TFile
	): SummaryQueueItem | undefined {
		const items = this.plugin.settings.summaryQueue.filter((item) => {
			if (noteFile && item.noteFile === noteFile.path) return true;
			if (pdfFile && item.pdfFile === pdfFile.path) return true;
			return false;
		});
		return items[items.length - 1];
	}

	private async runDuplicatePrompt(
		options: DuplicateResourceModalOptions
	): Promise<boolean> {
		const previousPrompt = this.duplicatePromptQueue;
		let releaseQueue!: () => void;
		this.duplicatePromptQueue = new Promise((resolve) => {
			releaseQueue = resolve;
		});

		await previousPrompt;
		try {
			return await DuplicateResourceModal.open(this.app, options);
		} finally {
			releaseQueue();
		}
	}

	private async confirmDuplicatePdf(meta: ArxivMeta, existingPdf: TFile): Promise<boolean> {
		const action = this.plugin.settings.existingPdfAction;
		if (action !== "ask") {
			return action === "overwrite";
		}

		return this.runDuplicatePrompt({
			heading: t("importModal.duplicatePdfHeading"),
			description: t("importModal.duplicatePdfDesc", {
				title: meta.title,
				path: existingPdf.path,
			}),
			keepButtonText: t("importModal.useExistingButton"),
			overwriteButtonText: t("importModal.redownloadButton"),
		});
	}

	private async confirmDuplicateNote(
		meta: ArxivMeta,
		existingNote: TFile
	): Promise<boolean> {
		const action = this.plugin.settings.existingNoteAction;
		if (action !== "ask") {
			return action === "overwrite";
		}

		return this.runDuplicatePrompt({
			heading: t("importModal.duplicateNoteHeading"),
			description: t("importModal.duplicateNoteDesc", {
				title: meta.title,
				path: existingNote.path,
			}),
			keepButtonText: t("importModal.useExistingButton"),
			overwriteButtonText: t("importModal.overwriteNoteButton"),
		});
	}

	private async resolvePdfFile(meta: ArxivMeta): Promise<TFile> {
		const existingPdf = findExistingPdfFile(
			this.app,
			meta,
			this.plugin.settings.attachmentFolderPath
		);

		if (!existingPdf) {
			return downloadPdf(
				this.app,
				meta,
				this.plugin.settings.attachmentFolderPath
			);
		}

		const shouldRedownload = await this.confirmDuplicatePdf(meta, existingPdf);
		return downloadPdf(
			this.app,
			meta,
			this.plugin.settings.attachmentFolderPath,
			{ overwrite: shouldRedownload }
		);
	}

	private async resolveNoteFile(
		meta: ArxivMeta,
		pdfFile: TFile
	): Promise<TFile> {
		const existingNote = findExistingPaperNote(
			this.app,
			meta,
			this.plugin.settings.notesFolderPath
		);

		if (!existingNote) {
			return createPaperNote(
				this.app,
				meta,
				pdfFile,
				this.plugin.settings.notesFolderPath,
				{ noteTemplate: this.plugin.settings.paperNoteTemplate }
			);
		}

		const shouldOverwrite = await this.confirmDuplicateNote(meta, existingNote);
		return createPaperNote(
			this.app,
			meta,
			pdfFile,
			this.plugin.settings.notesFolderPath,
			{
				overwrite: shouldOverwrite,
				noteTemplate: this.plugin.settings.paperNoteTemplate,
			}
		);
	}

	private async importOne(row: ImportRow): Promise<void> {
		const trimmed = row.url.trim();
		const arxivId = extractArxivId(trimmed);
		if (!arxivId) {
			row.status = "error";
			row.error = t("importModal.invalidArxivUrl", { url: trimmed });
			this.renderProgress();
			return;
		}

		row.status = "running";
		this.renderProgress();

		try {
			const meta = await fetchArxivMeta(arxivId);
			row.title = meta.title;
			row.stepsDone = 1;
			this.renderProgress();

			const pdfFile = await this.resolvePdfFile(meta);
			row.pdfFile = pdfFile;
			row.stepsDone = 2;
			this.renderProgress();

			const noteFile = await this.resolveNoteFile(meta, pdfFile);
			row.noteFile = noteFile;
			row.stepsDone = 3;
			row.status = "done";
			this.renderProgress();

			if (
				this.plugin.settings.autoAnalyzeAfterImport &&
				this.plugin.analyzeQueue
			) {
				await this.plugin.analyzeQueue.enqueue(pdfFile);
			}
			if (
				this.plugin.settings.autoSummarizeAfterImport &&
				this.plugin.summaryQueue
			) {
				await this.plugin.summaryQueue.enqueue(
					pdfFile,
					noteFile,
					this.plugin.settings.defaultSummaryEffort
				);
			}
			this.renderProgress();
		} catch (err: unknown) {
			row.status = "error";
			row.error = err instanceof Error ? err.message : String(err);
			this.renderProgress();
		}
	}

	private async runImport(): Promise<void> {
		// Filter out blank rows
		const activeRows = this.rows.filter((r) => r.url.trim().length > 0);
		if (activeRows.length === 0) {
			new Notice(t("notices.enterArxivUrl"));
			return;
		}

		this.importing = true;
		// Reset all rows for a fresh import run
		for (const row of activeRows) {
			row.status = "idle";
			row.stepsDone = 0;
			row.error = undefined;
			row.title = undefined;
		}

		const tasks = activeRows.map((row) => () => this.importOne(row));
		await runConcurrent(tasks, 5);

		const succeeded = activeRows.filter((r) => r.status === "done");
		const failed = activeRows.filter((r) => r.status === "error");
		new Notice(
			t("notices.importComplete", { succeeded: succeeded.length, failed: failed.length })
		);

		// Open the first successfully imported note
		if (succeeded[0]?.noteFile) {
			await this.app.workspace.openLinkText(
				succeeded[0].noteFile.path,
				"",
				false
			);
		}

		this.importing = false;
		const hasBackgroundTasks =
			this.plugin.settings.autoAnalyzeAfterImport ||
			this.plugin.settings.autoSummarizeAfterImport;
		if (failed.length === 0 && !hasBackgroundTasks) this.close();
	}
}
