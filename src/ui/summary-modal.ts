import {
	App,
	ButtonComponent,
	DropdownComponent,
	EventRef,
	Modal,
	Setting,
	TFile,
	normalizePath,
} from "obsidian";
import type PaperAnalyzerPlugin from "../main";
import type { SummaryEffort, SummaryQueueItem } from "../types";
import { t } from "../i18n";
import { resolvePaperContext } from "../services/paper-identity-resolver";

export class SummaryModal extends Modal {
	private plugin: PaperAnalyzerPlugin;
	private sourceFile: TFile;
	private pdfFile: TFile | null = null;
	private noteFile: TFile | null = null;
	private selectedEffort: SummaryEffort;

	private targetInfoEl: HTMLElement | null = null;
	private progressWrapEl: HTMLElement | null = null;
	private progressFillEl: HTMLElement | null = null;
	private statusTextEl: HTMLElement | null = null;
	private startBtn: ButtonComponent | null = null;
	private effortSelect: DropdownComponent | null = null;
	private queueEventRef: EventRef | null = null;

	constructor(app: App, plugin: PaperAnalyzerPlugin, sourceFile: TFile) {
		super(app);
		this.plugin = plugin;
		this.sourceFile = sourceFile;
		this.selectedEffort = plugin.settings.defaultSummaryEffort;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("paper-analyzer-modal");
		contentEl.addClass("paper-analyzer-modal--summary");
		new Setting(contentEl).setName(t("summaryModal.heading")).setHeading();
		contentEl
			.createDiv({
				cls: "paper-analyzer-modal-note paper-analyzer-surface paper-analyzer-surface--quiet",
			})
			.createEl("p", {
			text: t("summaryModal.sourceLabel", { name: this.sourceFile.name }),
			cls: "setting-item-description",
			});

		this.targetInfoEl = contentEl.createDiv({
			cls: "paper-analyzer-modal-note paper-analyzer-surface paper-analyzer-surface--quiet",
		});
		this.targetInfoEl.createEl("p", {
			text: t("summaryModal.loadingTarget"),
			cls: "setting-item-description",
		});

		const effortSetting = new Setting(contentEl)
			.setName(t("summaryModal.effortLabel"))
			.setDesc(t("summaryModal.effortDesc"))
			.addDropdown((dropdown) => {
				this.effortSelect = dropdown
					.addOption("low", t("settings.summaryEffortLow"))
					.addOption("medium", t("settings.summaryEffortMedium"))
					.addOption("high", t("settings.summaryEffortHigh"))
					.addOption("extream", t("settings.summaryEffortExtream"))
					.setValue(this.selectedEffort)
					.onChange((value) => {
						if (
							value === "low" ||
							value === "medium" ||
							value === "high" ||
							value === "extream"
						) {
							this.selectedEffort = value;
						}
					});
			});
		effortSetting.settingEl.addClass("paper-analyzer-summary-effort-setting");

		const btnWrap = contentEl.createDiv({ cls: "paper-analyzer-btn-wrap" });
		this.startBtn = new ButtonComponent(btnWrap)
			.setButtonText(t("summaryModal.startButton"))
			.setCta()
			.setDisabled(true)
			.onClick(() => {
				const active = this.findActiveItem();
				if (active) {
					this.plugin.summaryQueue.cancel();
					return;
				}
				if (!this.pdfFile) return;
				void this.plugin.summaryQueue.enqueue(
					this.pdfFile,
					this.noteFile ?? undefined,
					this.selectedEffort
				);
			});

		this.progressWrapEl = contentEl.createDiv({
			cls: "paper-analyzer-progress-wrap paper-analyzer-surface",
		});
		this.progressWrapEl.hide();

		this.statusTextEl = this.progressWrapEl.createDiv({
			cls: "paper-analyzer-status-text",
		});
		const barEl = this.progressWrapEl.createDiv({
			cls: "paper-analyzer-progress-bar",
		});
		this.progressFillEl = barEl.createDiv({
			cls: "paper-analyzer-progress-fill",
		});

		this.queueEventRef = this.app.workspace.on(
			"paper-analyzer:queue-update",
			() => this.syncFromQueue()
		);

		void this.initializeTarget();
	}

	onClose(): void {
		if (this.queueEventRef) {
			this.app.workspace.offref(this.queueEventRef);
			this.queueEventRef = null;
		}
		this.contentEl.empty();
	}

	private async initializeTarget(): Promise<void> {
		try {
			const target = await this.resolveTargetFiles(this.sourceFile);
			this.pdfFile = target.pdfFile;
			this.noteFile = target.noteFile;
			this.renderTargetInfo();
			this.setControlsEnabled(true);
			this.syncFromQueue();
		} catch (error) {
			this.renderTargetError(error instanceof Error ? error.message : String(error));
			this.setControlsEnabled(false);
		}
	}

	private async resolveTargetFiles(
		file: TFile
	): Promise<{ pdfFile: TFile; noteFile: TFile | null }> {
		if (file.extension === "pdf") {
			const context = await resolvePaperContext(this.app, file, {
				notesFolderPath: this.plugin.settings.notesFolderPath,
				citationSidebar: this.plugin.settings.citationSidebar,
			});
			return {
				pdfFile: file,
				noteFile: context?.relatedNote ?? null,
			};
		}

		if (file.extension !== "md") {
			throw new Error(t("summaryModal.unsupportedFile"));
		}

		const pdfFile = await this.findPdfForNote(file);
		if (!pdfFile) {
			throw new Error(t("summaryModal.pdfNotLinked"));
		}

		return {
			pdfFile,
			noteFile: file,
		};
	}

	private async findPdfForNote(noteFile: TFile): Promise<TFile | null> {
		const cache = this.app.metadataCache.getFileCache(noteFile) as
			| {
				frontmatter?: Record<string, unknown>;
				embeds?: Array<{ link: string }>;
			  }
			| undefined;
		const frontmatterPdf =
			typeof cache?.frontmatter?.pdf_file === "string"
				? cache.frontmatter.pdf_file.trim()
				: "";
		const embeddedPdf =
			cache?.embeds?.find((embed) => embed.link.toLowerCase().endsWith(".pdf"))?.link ?? "";

		const candidates = [
			frontmatterPdf,
			embeddedPdf,
			normalizePath(`${this.plugin.settings.attachmentFolderPath}/${noteFile.basename}.pdf`),
		];

		for (const candidate of candidates) {
			const resolved = this.resolvePdfCandidate(candidate, noteFile);
			if (resolved) return resolved;
		}

		return null;
	}

	private resolvePdfCandidate(candidate: string, noteFile: TFile): TFile | null {
		const trimmed = candidate.trim();
		if (!trimmed) return null;

		const cleanLink = trimmed.replace(/^!\[\[/, "").replace(/\]\]$/, "").split("|")[0]?.trim() ?? "";
		if (!cleanLink) return null;

		const directMatch = this.app.vault.getAbstractFileByPath(cleanLink);
		if (directMatch instanceof TFile && directMatch.extension === "pdf") {
			return directMatch;
		}

		const linkedMatch = this.app.metadataCache.getFirstLinkpathDest(cleanLink, noteFile.path);
		if (linkedMatch instanceof TFile && linkedMatch.extension === "pdf") {
			return linkedMatch;
		}

		const attachmentPath = cleanLink.includes("/")
			? cleanLink
			: normalizePath(`${this.plugin.settings.attachmentFolderPath}/${cleanLink}`);
		const attachmentMatch = this.app.vault.getAbstractFileByPath(attachmentPath);
		if (attachmentMatch instanceof TFile && attachmentMatch.extension === "pdf") {
			return attachmentMatch;
		}

		return null;
	}

	private renderTargetInfo(): void {
		if (!this.targetInfoEl) return;
		this.targetInfoEl.empty();
		if (this.pdfFile) {
			this.targetInfoEl.createEl("p", {
				text: t("summaryModal.pdfLabel", { name: this.pdfFile.name }),
				cls: "setting-item-description",
			});
		}
		this.targetInfoEl.createEl("p", {
			text: this.noteFile
				? t("summaryModal.noteLabel", { name: this.noteFile.name })
				: t("summaryModal.noteAutoResolve"),
			cls: "setting-item-description",
		});
	}

	private renderTargetError(message: string): void {
		if (this.targetInfoEl) {
			this.targetInfoEl.empty();
			this.targetInfoEl.createEl("p", {
				text: `${t("summaryModal.errorPrefix")}${message}`,
				cls: "setting-item-description",
			});
		}
		this.showProgress();
		this.setBar(0);
		this.setText(`${t("summaryModal.errorPrefix")}${message}`);
	}

	private findActiveItem(): SummaryQueueItem | undefined {
		if (!this.pdfFile) return undefined;
		return this.plugin.settings.summaryQueue.find(
			(item) =>
				item.pdfFile === this.pdfFile?.path &&
				(item.status === "pending" || item.status === "running")
		);
	}

	private syncFromQueue(): void {
		if (!this.pdfFile) return;

		const active = this.findActiveItem();
		if (active) {
			this.selectedEffort = active.effort;
			this.effortSelect?.setValue(active.effort);
			this.setControlsEnabled(false);
			this.setBtnRunning();
			this.showProgress();

			const done = active.progress?.done ?? 0;
			const total = active.progress?.total ?? 0;
			const phase =
				active.progress?.phase ??
				(active.status === "pending"
					? t("summaryModal.waitingInQueue")
					: t("summaryModal.running"));
			const message = active.progress?.message?.trim();
			const pointerLabel = active.progress?.currentPointerLabel?.trim();
			const statusLabel = [phase, message && message !== phase ? message : "", pointerLabel]
				.filter(Boolean)
				.join(" · ");
			const elapsed = active.startedAt
				? `  [${((Date.now() - active.startedAt) / 1000).toFixed(1)}s]`
				: "";

			this.setBar(total > 0 ? done / total : 0);
			this.setText(
				total > 0
					? t("summaryModal.progressLabel", {
						stage: statusLabel,
						done: String(done),
						total: String(total),
						elapsed,
					})
					: `${statusLabel}${elapsed}`
			);
			return;
		}

		this.setControlsEnabled(true);
		this.setBtnIdle();
		const items = this.plugin.settings.summaryQueue.filter(
			(item) => item.pdfFile === this.pdfFile?.path
		);
		const last = items[items.length - 1];
		if (last?.status === "done") {
			this.showProgress();
			this.setBar(1);
			this.setText(t("summaryModal.done"));
			return;
		}
		if (last?.status === "error" && last.error !== "Cancelled") {
			this.showProgress();
			this.setBar(0);
			this.setText(t("summaryModal.errorPrefix") + (last.error ?? "unknown"));
			return;
		}
		this.hideProgress();
	}

	private setBar(fraction: number): void {
		if (this.progressFillEl) {
			this.progressFillEl.style.width = `${Math.round(fraction * 100)}%`;
		}
	}

	private setText(label: string): void {
		if (this.statusTextEl) this.statusTextEl.setText(label);
	}

	private showProgress(): void {
		if (this.progressWrapEl) this.progressWrapEl.show();
	}

	private hideProgress(): void {
		if (this.progressWrapEl) this.progressWrapEl.hide();
	}

	private setBtnRunning(): void {
		this.startBtn?.setButtonText(t("summaryModal.cancelButton")).removeCta().setWarning();
	}

	private setBtnIdle(): void {
		if (!this.startBtn) return;
		this.startBtn.buttonEl.removeClass("mod-warning");
		this.startBtn.setButtonText(t("summaryModal.startButton")).setCta();
	}

	private setControlsEnabled(enabled: boolean): void {
		this.startBtn?.setDisabled(!enabled && !this.findActiveItem());
		if (this.effortSelect) {
			this.effortSelect.selectEl.disabled = !enabled;
		}
	}
}