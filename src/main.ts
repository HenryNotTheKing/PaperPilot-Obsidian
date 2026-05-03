import { FileView, Plugin, TFile, normalizePath } from "obsidian";
import {
	DEFAULT_ARXIV_FIELD_ALIASES,
	DEFAULT_DOI_FIELD_ALIASES,
	normalizeCitationFieldAliases,
	normalizeLlmProvider,
	normalizeSummaryEffort,
	normalizeTypeColorMap,
} from "./types";
import type { PaperMeta } from "./types";
import {
	DEFAULT_SETTINGS,
	normalizeDuplicateImportAction,
	PaperAnalyzerSettings,
	PaperAnalyzerSettingTab,
} from "./settings";
import { CitationSidebarView, CITATION_SIDEBAR_TYPE } from "./ui/citation-sidebar";
import { setPdfWorkerSrc } from "./services/pdf-parser";
import { AnalyzeQueue } from "./services/analyze-queue";
import { SummaryQueue } from "./services/summary-queue";
import { extractArxivId } from "./services/arxiv-client";
import { isCitationGraphFile } from "./services/paper-identity-resolver";
import { t, setLocale } from "./i18n";
import type { PdfHighlightLayer } from "./ui/pdf-highlight-layer";

export default class PaperAnalyzerPlugin extends Plugin {
	settings!: PaperAnalyzerSettings;
	analyzeQueue!: AnalyzeQueue;
	summaryQueue!: SummaryQueue;
	private ribbonImportHandle: HTMLElement | null = null;
	private ribbonCitationGraphHandle: HTMLElement | null = null;
	private highlightLayers: PdfHighlightLayer[] = [];

	async onload(): Promise<void> {
		await this.loadSettings();

		// Point pdfjs-dist v5 worker to the file copied alongside main.js at build time
		const workerSrc = this.app.vault.adapter.getResourcePath(
			normalizePath(`${this.manifest.dir}/pdf.worker.min.mjs`)
		);
		setPdfWorkerSrc(workerSrc);

		this.registerCommands();
		this.registerRibbon();
		this.registerView(
			CITATION_SIDEBAR_TYPE,
			(leaf) => new CitationSidebarView(leaf, this)
		);

		// Keep sidebar in sync when user switches notes
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				this.notifyCitationSidebar(file);
			})
		);

		this.addSettingTab(new PaperAnalyzerSettingTab(this.app, this));

		this.analyzeQueue = new AnalyzeQueue(this);
		this.summaryQueue = new SummaryQueue(this);

		// Defer queue resume until Obsidian finishes its own startup
		this.app.workspace.onLayoutReady(() => {
			void this.analyzeQueue.processNext();
			void this.summaryQueue.processNext();
		});

		// Mount highlight overlays on any already-open PDF leaves, and on future ones
		this.registerEvent(
			this.app.workspace.on("layout-change", () => {
				void this.refreshPdfHighlights();
			})
		);
		this.app.workspace.onLayoutReady(() => {
			void this.refreshPdfHighlights();
		});
	}

	private registerCommands(): void {
		this.addCommand({
			id: "import-arxiv-paper",
			name: t("commands.importArxivPaper"),
			callback: async () => {
				const { ImportModal } = await import("./ui/import-modal");
				new ImportModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: "analyze-arxiv-paper",
			name: t("commands.analyzeCurrentPaper"),
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile || activeFile.extension !== "pdf") return false;
				if (!checking) void this.launchAnalysis(activeFile);
				return true;
			},
		});

		this.addCommand({
			id: "summarize-current-paper",
			name: t("commands.summarizeCurrentPaper"),
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile || (activeFile.extension !== "pdf" && activeFile.extension !== "md")) {
					return false;
				}
				if (!checking) void this.launchSummary(activeFile);
				return true;
			},
		});

		this.addCommand({
			id: "open-citation-sidebar",
			name: t("commands.openCitationSidebar"),
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!isCitationGraphFile(file)) return false;
				if (!checking) void this.openCitationSidebar();
				return true;
			},
		});

		this.addCommand({
			id: "export-citation-current",
			name: t("commands.exportCitationCurrent"),
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile || activeFile.extension !== "md") return false;
				if (!checking) {
					void (async () => {
						const { CitationExportModal } = await import("./ui/citation-export-modal");
						new CitationExportModal(this.app, this, activeFile, "current").open();
					})();
				}
				return true;
			},
		});

		this.addCommand({
			id: "export-citation-by-tag",
			name: t("commands.exportCitationByTag"),
			callback: async () => {
				const { CitationExportModal } = await import("./ui/citation-export-modal");
				new CitationExportModal(this.app, this, null, "tag").open();
			},
		});
	}

	private registerRibbon(): void {
		this.ribbonImportHandle = this.addRibbonIcon(
			"file-down",
			t("commands.ribbonImport"),
			async () => {
				const { ImportModal } = await import("./ui/import-modal");
				new ImportModal(this.app, this).open();
			}
		);
		this.ribbonCitationGraphHandle = this.addRibbonIcon(
			"library",
			t("commands.ribbonCitationGraph"),
			() => void this.openCitationSidebar()
		);
	}

	/** Refresh all user-facing strings after language change. */
	refreshI18n(): void {
		// Re-register commands with updated names (remove old ones first)
		const cmdManager = this.app as unknown as { commands: { removeCommand: (id: string) => void } };
		cmdManager.commands.removeCommand("import-arxiv-paper");
		cmdManager.commands.removeCommand("analyze-arxiv-paper");
		cmdManager.commands.removeCommand("summarize-current-paper");
		cmdManager.commands.removeCommand("open-citation-sidebar");
		cmdManager.commands.removeCommand("export-citation-current");
		cmdManager.commands.removeCommand("export-citation-by-tag");
		this.registerCommands();

		// Destroy old ribbon icons and recreate with updated tooltips
		this.ribbonImportHandle?.remove();
		this.ribbonCitationGraphHandle?.remove();
		this.ribbonImportHandle = null;
		this.ribbonCitationGraphHandle = null;
		this.registerRibbon();

		// Trigger sidebar re-render so getDisplayText() re-evaluates
		const leaves = this.app.workspace.getLeavesOfType(CITATION_SIDEBAR_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view as CitationSidebarView;
			view.sidebarState.refresh();
		}
	}

	private async openCitationSidebar(): Promise<void> {
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: CITATION_SIDEBAR_TYPE, active: true });
		void this.app.workspace.revealLeaf(leaf);
	}

	private notifyCitationSidebar(file: TFile | null): void {
		const leaves = this.app.workspace.getLeavesOfType(CITATION_SIDEBAR_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view as CitationSidebarView;
			view.sidebarState.onFileOpen(file);
		}
	}

	async importAndAnalyze(paper: PaperMeta): Promise<void> {
		console.debug("[importAndAnalyze] called with:", JSON.stringify({ id: paper.id, url: paper.url, pdfUrl: paper.pdfUrl }));
		// Try to extract an arxiv ID using the robust extractArxivId function
		const candidates = [paper.url, paper.pdfUrl, paper.id].filter(Boolean) as string[];
		console.debug("[importAndAnalyze] candidates:", candidates);
		for (const candidate of candidates) {
			const arxivId = extractArxivId(candidate);
			if (arxivId) {
				console.debug("[importAndAnalyze] matched arxivId:", arxivId, "from candidate:", candidate);
				const { ImportModal } = await import("./ui/import-modal");
				new ImportModal(this.app, this, [`https://arxiv.org/abs/${arxivId}`]).open();
				return;
			}
		}
		// Fallback: open the paper URL in the browser
		if (paper.url) {
			console.debug("[importAndAnalyze] fallback opening url:", paper.url);
			window.open(paper.url, "_blank", "noopener,noreferrer");
		} else if (paper.id && !paper.id.includes("/") && paper.id.length > 20) {
			// For citation papers that may only have S2 URLs (no arxiv/DOI)
			const s2Url = `https://www.semanticscholar.org/paper/${paper.id}`;
			console.debug("[importAndAnalyze] fallback opening s2Url:", s2Url);
			window.open(s2Url, "_blank", "noopener,noreferrer");
		}
	}

	onunload(): void {
		for (const layer of this.highlightLayers) layer.destroy();
		this.highlightLayers = [];
	}

	async refreshPdfHighlights(): Promise<void> {
		const highlights = this.settings.highlights;
		if (!highlights || Object.keys(highlights).length === 0) return;

		const { PdfHighlightLayer } = await import("./ui/pdf-highlight-layer");

		// Clean up stale layers (viewer may have been destroyed during zoom)
		this.highlightLayers = this.highlightLayers.filter((layer) => {
			const viewer = layer.containerEl.querySelector(".pdfViewer");
			if (!viewer || !viewer.getAttribute("data-pa-attached")) {
				layer.destroy();
				return false;
			}
			return true;
		});

		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view.getViewType() !== "pdf") return;

			const file =
				leaf.view instanceof FileView ? leaf.view.file : null;
			if (!file) return;

			const hlData = highlights[file.path];
			if (!hlData || hlData.length === 0) return;

			const pdfViewer = leaf.view.containerEl.querySelector<HTMLElement>(".pdfViewer");
			if (!pdfViewer) return;

			// Skip if this viewer already has a layer attached
			const existing = this.highlightLayers.find(
				(l) => l.containerEl === leaf.view.containerEl
			);
			if (existing) return;

			const layer = new PdfHighlightLayer(
				leaf.view.containerEl,
				hlData,
				this.settings.typeColorMap,
				this.settings.highlightOpacity
			);
			layer.attach();
			this.highlightLayers.push(layer);
		});
	}

	rerenderPdfHighlights(): void {
		for (const layer of this.highlightLayers) layer.destroy();
		this.highlightLayers = [];
		void this.refreshPdfHighlights();
	}

	private async launchAnalysis(pdfFile: TFile): Promise<void> {
		const { AnalyzeModal } = await import("./ui/analyze-modal");
		new AnalyzeModal(this.app, this, pdfFile).open();
	}

	private async launchSummary(file: TFile): Promise<void> {
		const { SummaryModal } = await import("./ui/summary-modal");
		new SummaryModal(this.app, this, file).open();
	}

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<PaperAnalyzerSettings>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		setLocale(this.settings.language ?? "en");

		const CURRENT_SETTINGS_VERSION = 1;

		// Fast path: skip expensive normalization if settings are already current
		if (this.settings.settingsVersion === CURRENT_SETTINGS_VERSION) {
			this.sanitizeQueues();
			return;
		}

		// Migration / normalization path (runs once after upgrade)
		const loadedCitationSidebar = loaded?.citationSidebar as
			| (Record<string, unknown> & Partial<PaperAnalyzerSettings["citationSidebar"]>)
			| undefined;
		if (loadedCitationSidebar) {
			this.settings.citationSidebar = {
				...DEFAULT_SETTINGS.citationSidebar,
				...loadedCitationSidebar,
			};
		}

		if (
			Object.prototype.hasOwnProperty.call(
				this.settings.citationSidebar as unknown as Record<string, unknown>,
				"openalexApiKey"
			)
		) {
			delete (this.settings.citationSidebar as unknown as Record<string, unknown>)["openalexApiKey"];
		}

		const legacyOpenalexApiKey =
			typeof loadedCitationSidebar?.["openalexApiKey"] === "string"
				? loadedCitationSidebar["openalexApiKey"].trim()
				: "";
		if (
			legacyOpenalexApiKey &&
			this.settings.citationSidebar.semanticScholarApiKey === legacyOpenalexApiKey
		) {
			this.settings.citationSidebar.semanticScholarApiKey = "";
		}

		const normalized: PaperAnalyzerSettings = {
			...this.settings,
			citationSidebar: {
				...this.settings.citationSidebar,
				arxivFieldAliases: normalizeCitationFieldAliases(
					this.settings.citationSidebar.arxivFieldAliases,
					DEFAULT_ARXIV_FIELD_ALIASES
				),
				doiFieldAliases: normalizeCitationFieldAliases(
					this.settings.citationSidebar.doiFieldAliases,
					DEFAULT_DOI_FIELD_ALIASES
				),
			},
			typeColorMap: normalizeTypeColorMap(loaded?.typeColorMap),
			highlightOpacity: Math.min(
				1,
				Math.max(0.15, loaded?.highlightOpacity ?? DEFAULT_SETTINGS.highlightOpacity)
			),
			existingPdfAction: normalizeDuplicateImportAction(
				loaded?.existingPdfAction,
				DEFAULT_SETTINGS.existingPdfAction
			),
			existingNoteAction: normalizeDuplicateImportAction(
				loaded?.existingNoteAction,
				DEFAULT_SETTINGS.existingNoteAction
			),
			extractionProvider: normalizeLlmProvider(
				loaded?.extractionProvider,
				DEFAULT_SETTINGS.extractionProvider
			),
			summaryProvider: normalizeLlmProvider(
				loaded?.summaryProvider,
				DEFAULT_SETTINGS.summaryProvider
			),
			huggingFaceUserId:
				typeof loaded?.huggingFaceUserId === "string"
					? loaded.huggingFaceUserId.trim()
					: DEFAULT_SETTINGS.huggingFaceUserId,
			huggingFaceApiKey:
				typeof loaded?.huggingFaceApiKey === "string"
					? loaded.huggingFaceApiKey.trim()
					: DEFAULT_SETTINGS.huggingFaceApiKey,
			preferHuggingFacePaperMarkdown: loaded?.preferHuggingFacePaperMarkdown !== false,
			autoSummarizeAfterImport: loaded?.autoSummarizeAfterImport === true,
			defaultSummaryEffort: normalizeSummaryEffort(
				loaded?.defaultSummaryEffort,
				DEFAULT_SETTINGS.defaultSummaryEffort
			),
			summaryLowPrompt:
				typeof loaded?.summaryLowPrompt === "string"
					? loaded.summaryLowPrompt
					: DEFAULT_SETTINGS.summaryLowPrompt,
			summaryMediumPrompt:
				typeof loaded?.summaryMediumPrompt === "string"
					? loaded.summaryMediumPrompt
					: DEFAULT_SETTINGS.summaryMediumPrompt,
			summaryHighPrompt:
				typeof loaded?.summaryHighPrompt === "string"
					? loaded.summaryHighPrompt
					: DEFAULT_SETTINGS.summaryHighPrompt,
			summaryExtreamPrompt:
				typeof loaded?.summaryExtreamPrompt === "string"
					? loaded.summaryExtreamPrompt
					: DEFAULT_SETTINGS.summaryExtreamPrompt,
			summaryLowPromptZh:
				typeof loaded?.summaryLowPromptZh === "string"
					? loaded.summaryLowPromptZh
					: DEFAULT_SETTINGS.summaryLowPromptZh,
			summaryMediumPromptZh:
				typeof loaded?.summaryMediumPromptZh === "string"
					? loaded.summaryMediumPromptZh
					: DEFAULT_SETTINGS.summaryMediumPromptZh,
			summaryHighPromptZh:
				typeof loaded?.summaryHighPromptZh === "string"
					? loaded.summaryHighPromptZh
					: DEFAULT_SETTINGS.summaryHighPromptZh,
			summaryExtreamPromptZh:
				typeof loaded?.summaryExtreamPromptZh === "string"
					? loaded.summaryExtreamPromptZh
					: DEFAULT_SETTINGS.summaryExtreamPromptZh,
			paperNoteTemplate:
				typeof loaded?.paperNoteTemplate === "string"
					? loaded.paperNoteTemplate
					: DEFAULT_SETTINGS.paperNoteTemplate,
			settingsVersion: CURRENT_SETTINGS_VERSION,
		};

		if (JSON.stringify(this.settings) !== JSON.stringify(normalized)) {
			this.settings = normalized;
			await this.saveData(this.settings);
		}

		this.sanitizeQueues();
	}

	private sanitizeQueues(): void {
		this.settings.analyzeQueue = (this.settings.analyzeQueue ?? []).filter(
			(item): item is import("./types").QueueItem => {
				const r = item as unknown as Record<string, unknown>;
				return (
					typeof r["id"] === "string" &&
					typeof r["pdfFile"] === "string" &&
					["pending", "running", "done", "error"].includes(r["status"] as string)
				);
			}
		);
		this.settings.analyzeQueue.forEach((item) => {
			if (item.status === "running") item.status = "pending";
		});

		this.settings.summaryQueue = (this.settings.summaryQueue ?? []).filter(
			(item): item is import("./types").SummaryQueueItem => {
				const r = item as unknown as Record<string, unknown>;
				return (
					typeof r["id"] === "string" &&
					typeof r["pdfFile"] === "string" &&
					["low", "medium", "high", "extream"].includes(
						r["effort"] as string
					) &&
					["pending", "running", "done", "error"].includes(r["status"] as string)
				);
			}
		);
		this.settings.summaryQueue.forEach((item) => {
			if (item.status === "running") item.status = "pending";
		});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
