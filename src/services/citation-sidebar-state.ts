import { App, TFile } from "obsidian";
import type { CitationCard } from "../types";
import type { PaperAnalyzerSettings } from "../settings";
import { computeSimilarity } from "./tfidf-ranker";
import { fetchCitations, fetchReferences } from "./openalex-client";
import { isCitationGraphFile, resolvePaperContext, type ResolvedPaperContext } from "./paper-identity-resolver";

export class CitationSidebarState {
	private app: App;
	private citationCards: CitationCard[] = [];
	private referenceCards: CitationCard[] = [];
	private activeTab: "citations" | "references" = "citations";
	private loading = false;
	private debounceTimer: number | null = null;
	private getSettings: () => PaperAnalyzerSettings;
	private resolvedContext: ResolvedPaperContext | null = null;
	private loadRequestId = 0;

	constructor(app: App, getSettings: () => PaperAnalyzerSettings) {
		this.app = app;
		this.getSettings = getSettings;
	}

	onFileOpen(file: TFile | null): void {
		if (this.debounceTimer !== null) {
			window.clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = window.setTimeout(() => {
			void this.load(file);
		}, 300);
	}

	private async load(file: TFile | null): Promise<void> {
		const requestId = ++this.loadRequestId;
		this.citationCards = [];
		this.referenceCards = [];
		this.resolvedContext = null;

		if (!isCitationGraphFile(file)) {
			this.loading = false;
			this.emitChange();
			return;
		}

		this.loading = true;
		this.emitChange();

		const settings = this.getSettings();
		const context = await resolvePaperContext(this.app, file, {
			notesFolderPath: settings.notesFolderPath,
			citationSidebar: settings.citationSidebar,
		});
		if (requestId !== this.loadRequestId) return;

		if (!context) {
			this.loading = false;
			this.emitChange();
			return;
		}

		this.resolvedContext = context;

		try {
			const qualifiedId = `${context.paperId.type}:${context.paperId.id}`;
			const [citations, references] = await Promise.all([
				fetchCitations(
					qualifiedId,
					settings.citationSidebar.maxResults,
					settings.citationSidebar.semanticScholarApiKey
				),
				fetchReferences(
					qualifiedId,
					settings.citationSidebar.maxResults,
					settings.citationSidebar.semanticScholarApiKey
				),
			]);
			if (requestId !== this.loadRequestId) return;

			const buildCards = (papers: typeof citations): CitationCard[] => {
				if (papers.length === 0) return [];
				const corpus = papers.map((p) => `${p.title} ${p.abstract}`);
				const simScores = computeSimilarity(context.queryText, corpus);
				const maxCit = Math.max(...papers.map((p) => p.citationCount), 1);
				return papers
					.map((paper, i) => {
						const sim = simScores[i] ?? 0;
						const inf = Math.log1p(paper.citationCount) / Math.log1p(maxCit);
						return {
							paper,
							similarityScore: sim,
							influenceScore: inf,
							finalScore: 0.7 * sim + 0.3 * inf,
							expanded: false,
						};
					})
					.sort((a, b) => b.finalScore - a.finalScore);
			};

			this.citationCards = buildCards(citations);
			this.referenceCards = buildCards(references);
		} catch (err) {
			console.error("[CitationSidebar] Failed to load citations:", err);
		} finally {
			if (requestId === this.loadRequestId) {
				this.loading = false;
				this.emitChange();
			}
		}
	}

	getCards(): CitationCard[] {
		return this.activeTab === "citations" ? this.citationCards : this.referenceCards;
	}

	getTabCounts(): { citations: number; references: number } {
		return {
			citations: this.citationCards.length,
			references: this.referenceCards.length,
		};
	}

	getActiveTab(): "citations" | "references" {
		return this.activeTab;
	}

	setTab(tab: "citations" | "references"): void {
		this.activeTab = tab;
		this.emitChange();
	}

	isLoading(): boolean {
		return this.loading;
	}

	hasResolvedPaper(): boolean {
		return this.resolvedContext !== null;
	}

	hasApiKey(): boolean {
		return this.getSettings().citationSidebar.semanticScholarApiKey.length > 0;
	}

	setExpanded(paperId: string, expanded: boolean): void {
		const list = this.activeTab === "citations" ? this.citationCards : this.referenceCards;
		const card = list.find((c) => c.paper.id === paperId);
		if (card) {
			card.expanded = expanded;
			this.emitChange();
		}
	}

	/** Re-emit the last state so views re-render (used after language change). */
	refresh(): void {
		this.emitChange();
	}

	private emitChange(): void {
		this.app.workspace.trigger("citation-sidebar:state-change");
	}
}
