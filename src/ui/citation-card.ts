import { ButtonComponent } from "obsidian";
import type { CitationCard } from "../types";
import type { PaperMeta } from "../types";
import { t } from "../i18n";

export interface CardCallbacks {
	onTitleClick: (paper: PaperMeta, ctrlKey: boolean) => void;
	onImportClick: (paper: PaperMeta) => void;
	onExpandToggle: (paperId: string, expanded: boolean) => void;
}

export function renderCard(
	card: CitationCard,
	container: HTMLElement,
	callbacks: CardCallbacks
): void {
	const { paper, similarityScore, influenceScore, finalScore, expanded } = card;

	const cardEl = container.createDiv({ cls: "citation-card" });
	if (expanded) cardEl.addClass("citation-card--expanded");

	// Title — clickable to open paper URL
	const titleEl = cardEl.createEl("div", { cls: "citation-card-title" });
	titleEl.setText(paper.title);
	titleEl.addEventListener("click", (e) => {
		e.stopPropagation();
		callbacks.onTitleClick(paper, e.ctrlKey || e.metaKey);
	});

	// Meta row: Authors · Year · Citation count · Relevance badge
	const metaEl = cardEl.createEl("div", { cls: "citation-card-meta" });
	const displayAuthors = paper.authors.slice(0, 3).join(", ");
	const authorText =
		paper.authors.length > 3 ? `${displayAuthors} et al.` : displayAuthors;
	const metaText = [
		authorText || t("citationCard.unknownAuthors"),
		paper.year ? String(paper.year) : "",
		`${paper.citationCount} citations`,
	]
		.filter(Boolean)
		.join("  ·  ");
	metaEl.createEl("span", { text: metaText });

	// Relevance score badge
	const badgeEl = metaEl.createEl("span", { cls: "citation-card-score" });
	badgeEl.setText(`${Math.round(finalScore * 100)}`);
	badgeEl.title = t("citationCard.relevanceInfluence", {
	similarity: Math.round(similarityScore * 100),
	influence: Math.round(influenceScore * 100),
});

	// Abstract — truncated by default, expands on click
	const abstractEl = cardEl.createEl("div", { cls: "citation-card-abstract" });
	abstractEl.setText(paper.abstract || t("citationCard.noAbstract"));
	if (expanded) abstractEl.addClass("expanded");

	// Click anywhere on card body to toggle expand
	cardEl.addEventListener("click", () => {
		callbacks.onExpandToggle(paper.id, !expanded);
	});

	// Actions row
	const actionsEl = cardEl.createEl("div", { cls: "citation-card-actions" });
	const importBtn = new ButtonComponent(actionsEl);
	importBtn.setIcon("download");
	importBtn.setTooltip(t("citationCard.importTooltip"));
	importBtn.setCta();
	importBtn.buttonEl.addClass("citation-import-btn");
	importBtn.onClick((e) => {
		e.stopPropagation();
		console.log("[citation-card] import button clicked for paper:", callbacks.onImportClick.toString().slice(0, 100));
		callbacks.onImportClick(paper);
	});
}
