import { ItemView, WorkspaceLeaf } from "obsidian";
import type PaperAnalyzerPlugin from "../main";
import { CitationSidebarState } from "../services/citation-sidebar-state";
import { renderCard } from "./citation-card";
import { t } from "../i18n";

export const CITATION_SIDEBAR_TYPE = "citation-graph-sidebar";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠴", "⠦", "⠧", "⠇"];

export class CitationSidebarView extends ItemView {
	private plugin: PaperAnalyzerPlugin;
	readonly sidebarState: CitationSidebarState;
	private spinnerIntervalId: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: PaperAnalyzerPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.sidebarState = new CitationSidebarState(plugin.app, () => plugin.settings);
	}

	getViewType(): string {
		return CITATION_SIDEBAR_TYPE;
	}

	getDisplayText(): string {
		return t("citationSidebar.displayText");
	}

	getIcon(): string {
		return "library";
	}

	async onOpen(): Promise<void> {
		// Listen for state updates from CitationSidebarState
		this.registerEvent(
			this.app.workspace.on("citation-sidebar:state-change", () => {
				this.render();
			})
		);

		// Trigger load for the currently active file
		const currentFile = this.app.workspace.getActiveFile();
		if (currentFile) {
			this.sidebarState.onFileOpen(currentFile);
		} else {
			this.render();
		}
	}

	onClose(): Promise<void> {
		if (this.spinnerIntervalId !== null) {
			window.clearInterval(this.spinnerIntervalId);
			this.spinnerIntervalId = null;
		}
		return Promise.resolve();
	}

	private render(): void {
		// Stop any previous spinner
		if (this.spinnerIntervalId !== null) {
			window.clearInterval(this.spinnerIntervalId);
			this.spinnerIntervalId = null;
		}

		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("citation-sidebar");

		if (this.sidebarState.isLoading()) {
			this.renderLoading(container);
			return;
		}

		const counts = this.sidebarState.getTabCounts();
		const activeTab = this.sidebarState.getActiveTab();

		// Tab bar
		const tabBar = container.createDiv({ cls: "citation-sidebar-tabs" });
		const citTab = tabBar.createEl("button", {
			cls: "citation-sidebar-tab" + (activeTab === "citations" ? " is-active" : ""),
			text: t("citationSidebar.citedByTab", { count: counts.citations }),
		});
		citTab.addEventListener("click", () => {
			this.sidebarState.setTab("citations");
		});
		const refTab = tabBar.createEl("button", {
			cls: "citation-sidebar-tab" + (activeTab === "references" ? " is-active" : ""),
			text: t("citationSidebar.referencesTab", { count: counts.references }),
		});
		refTab.addEventListener("click", () => {
			this.sidebarState.setTab("references");
		});

		const cards = this.sidebarState.getCards();
		if (cards.length === 0) {
			this.renderEmpty(container);
			return;
		}

		const listEl = container.createDiv({ cls: "citation-card-list" });
		for (const card of cards) {
			renderCard(card, listEl, {
				onTitleClick: (paper, ctrlKey) => {
					const url = paper.url || paper.pdfUrl;
					if (!url) return;
					if (ctrlKey) {
						this.openExternal(url);
					} else {
						this.openInObsidian(url);
					}
				},
				onImportClick: (paper) => {
					void this.plugin.importAndAnalyze(paper);
				},
				onExpandToggle: (paperId, expanded) => {
					this.sidebarState.setExpanded(paperId, expanded);
				},
			});
		}
	}

	private renderLoading(container: HTMLElement): void {
		const wrap = container.createDiv({ cls: "citation-sidebar-loading" });
		wrap.createEl("div", {
			text: t("citationSidebar.loading"),
			cls: "citation-sidebar-status",
		});
		const spinnerEl = wrap.createEl("div", { cls: "citation-sidebar-spinner" });
		let frame = 0;
		this.spinnerIntervalId = window.setInterval(() => {
			spinnerEl.setText(SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length] ?? "⠋");
		}, 80);
	}

	private renderEmpty(container: HTMLElement): void {
		const emptyEl = container.createDiv({ cls: "citation-sidebar-empty" });
		emptyEl.setText(
			this.sidebarState.hasResolvedPaper()
				? t("citationSidebar.noCitationsFound")
				: t("citationSidebar.openNoteWithId")
		);
	}

	private getPluginsApi(): Record<string, unknown> {
		return (this.app as unknown as { plugins: Record<string, unknown> }).plugins;
	}

	private isSurfingEnabled(): boolean {
		const pluginsApi = this.getPluginsApi();
		const enabled = pluginsApi["enabledPlugins"] as Set<string> | undefined;
		return enabled?.has("surfing") ?? false;
	}

	private openInObsidian(url: string): void {
		if (this.isSurfingEnabled()) {
			const pluginsMap = this.getPluginsApi()["plugins"] as
				| Record<string, unknown>
				| undefined;
			const surfing = pluginsMap?.["surfing"] as
				| { openUrlInNewTab?: (url: string) => void }
				| undefined;
			if (surfing?.openUrlInNewTab) {
				surfing.openUrlInNewTab(url);
				return;
			}
		}
		window.open(url, "_blank");
	}

	private openExternal(url: string): void {
		try {
			const w = window as unknown as Record<string, unknown>;
			if (typeof w["require"] === "function") {
				const electron = (w["require"] as (m: string) => unknown)("electron") as {
					shell: { openExternal: (u: string) => void };
				};
				electron.shell.openExternal(url);
				return;
			}
		} catch {
			// Not in Electron context
		}
		window.open(url, "_blank");
	}
}
