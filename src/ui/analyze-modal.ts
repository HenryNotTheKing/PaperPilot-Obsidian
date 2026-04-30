import { App, ButtonComponent, EventRef, Modal, Setting, TFile } from "obsidian";
import type PaperAnalyzerPlugin from "../main";
import { t, tArray } from "../i18n";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class AnalyzeModal extends Modal {
	private plugin: PaperAnalyzerPlugin;
	private pdfFile: TFile;

	private progressWrapEl: HTMLElement | null = null;
	private progressFillEl: HTMLElement | null = null;
	private statusTextEl: HTMLElement | null = null;
	private spinnerEl: HTMLElement | null = null;
	private startBtn: ButtonComponent | null = null;

	private spinnerTimer: number | null = null;
	private queueEventRef: EventRef | null = null;

	constructor(
		app: App,
		plugin: PaperAnalyzerPlugin,
		pdfFile: TFile
	) {
		super(app);
		this.plugin = plugin;
		this.pdfFile = pdfFile;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("paper-analyzer-modal");
		contentEl.addClass("paper-analyzer-modal--analyze");
		new Setting(contentEl).setName(t("analyzeModal.heading")).setHeading();
		const noteEl = contentEl.createDiv({
			cls: "paper-analyzer-modal-note paper-analyzer-surface paper-analyzer-surface--quiet",
		});
		noteEl.createEl("p", {
			text: t("analyzeModal.pdfLabel", { name: this.pdfFile.name }),
			cls: "setting-item-description",
		});

		const btnWrap = contentEl.createDiv({ cls: "paper-analyzer-btn-wrap" });
		this.startBtn = new ButtonComponent(btnWrap)
			.setButtonText(t("analyzeModal.startButton"))
			.setCta()
			.onClick(() => {
				if (this.findActiveItem()) {
					this.plugin.analyzeQueue.cancel();
				} else {
					void this.plugin.analyzeQueue.enqueue(this.pdfFile);
				}
			});

		this.progressWrapEl = contentEl.createDiv({
			cls: "paper-analyzer-progress-wrap paper-analyzer-surface",
		});
		this.progressWrapEl.style.display = "none";

		const statusRow = this.progressWrapEl.createDiv({
			cls: "paper-analyzer-status-row",
		});
		this.spinnerEl = statusRow.createSpan({ cls: "paper-analyzer-spinner" });
		this.statusTextEl = statusRow.createSpan({ cls: "paper-analyzer-status-text" });

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

		// Reconnect if a task is already running for this PDF
		this.syncFromQueue();
	}

	onClose(): void {
		if (this.queueEventRef) {
			this.app.workspace.offref(this.queueEventRef);
			this.queueEventRef = null;
		}
		this.stopSpinner();
		this.contentEl.empty();
	}

	// --- Queue helpers ---

	private findActiveItem() {
		return this.plugin.settings.analyzeQueue.find(
			(i) =>
				i.pdfFile === this.pdfFile.path &&
				(i.status === "pending" || i.status === "running")
		);
	}

	private syncFromQueue(): void {
		const active = this.findActiveItem();

		if (!active) {
			this.stopSpinner();
			this.setBtnIdle();
			// Show last terminal state for this PDF if any
			const allItems = this.plugin.settings.analyzeQueue.filter(
				(i) => i.pdfFile === this.pdfFile.path
			);
			const last = allItems[allItems.length - 1];
			if (last?.status === "done") {
				this.showProgress();
				this.setBar(1);
				this.setText(t("analyzeModal.done"));
			} else if (last?.status === "error" && last.error !== "Cancelled") {
				this.showProgress();
				this.setBar(0);
				this.setText(t("analyzeModal.errorPrefix") + (last.error ?? "unknown"));
			} else {
				this.hideProgress();
			}
			return;
		}

		// Active task found
		this.setBtnRunning();
		this.showProgress();

		if (active.progress) {
			// At least one chunk has completed — show real progress
			this.stopSpinner();
			const { done, total } = active.progress;
			const frac = total > 0 ? done / total : 0;
			const elapsed = active.startedAt
				? `  [${((Date.now() - active.startedAt) / 1000).toFixed(1)}s]`
				: "";
			this.setBar(frac);
			this.setText(
				t("analyzeModal.chunksProgress", { done: String(done), total: String(total), elapsed })
			);
		} else {
			// Waiting for first chunk — spinner, empty bar
			this.setBar(0);
			this.setText(
				active.status === "pending" ? t("analyzeModal.waitingInQueue") : t("analyzeModal.analyzing")
			);
			this.startSpinner();
		}
	}

	// --- Spinner ---

	private startSpinner(): void {
		if (this.spinnerTimer !== null) return; // already running
		const hints = tArray("analyzeModal.spinnerHints");
		let frame = 0;
		this.spinnerTimer = window.setInterval(() => {
			const icon = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "⠋";
			if (this.spinnerEl) this.spinnerEl.setText(icon);
			// Rotate hint text every ~4 s (50 frames × 80 ms)
			if (frame > 0 && frame % 50 === 0) {
				const idx = Math.floor(Math.random() * hints.length);
				if (this.statusTextEl) this.statusTextEl.setText(hints[idx] ?? t("analyzeModal.analyzing"));
			}
			frame++;
		}, 80);
	}

	private stopSpinner(): void {
		if (this.spinnerTimer !== null) {
			window.clearInterval(this.spinnerTimer);
			this.spinnerTimer = null;
		}
		if (this.spinnerEl) this.spinnerEl.setText("");
	}

	// --- UI helpers ---

	private setBar(fraction: number): void {
		if (this.progressFillEl)
			this.progressFillEl.style.width = `${Math.round(fraction * 100)}%`;
	}

	private setText(label: string): void {
		if (this.statusTextEl) this.statusTextEl.setText(label);
	}

	private showProgress(): void {
		if (this.progressWrapEl) this.progressWrapEl.style.display = "";
	}

	private hideProgress(): void {
		if (this.progressWrapEl) this.progressWrapEl.style.display = "none";
	}

	private setBtnRunning(): void {
		this.startBtn?.setButtonText(t("analyzeModal.cancelButton")).removeCta().setWarning();
	}

	private setBtnIdle(): void {
		if (!this.startBtn) return;
		this.startBtn.buttonEl.removeClass("mod-warning");
		this.startBtn.setButtonText(t("analyzeModal.startButton")).setCta();
	}
}
