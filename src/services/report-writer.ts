import type { App, TFile } from "obsidian";
import type { PdfAnchor, SectionTag } from "../types";

const SECTION_LABELS: Record<SectionTag, string> = {
	abstract: "Abstract",
	introduction: "Introduction",
	related_work: "Related Work",
	method: "Method",
	experiment: "Experiment & Results",
	conclusion: "Conclusion",
	other: "Other",
};

const SECTION_ORDER: SectionTag[] = [
	"abstract",
	"introduction",
	"related_work",
	"method",
	"experiment",
	"conclusion",
	"other",
];

/** Compute a unique grouping key for each anchor. Anchors with the same
 *  headingText (or same sectionTag if no heading) are grouped together. */
function groupKey(anchor: PdfAnchor): string {
	return anchor.headingText ?? anchor.sectionTag;
}

/** Determine display label for a group. Prefer headingText, fall back to SECTION_LABELS. */
function groupLabel(anchor: PdfAnchor): string {
	if (anchor.headingText) return anchor.headingText;
	return SECTION_LABELS[anchor.sectionTag] ?? "Other";
}

/** Sort priority: standard SectionTag order first, then custom headings in appearance order */
function groupSortKey(key: string, sectionTag: SectionTag): number {
	const idx = SECTION_ORDER.indexOf(sectionTag);
	// Standard tags that aren't "other" get high priority
	if (idx !== -1 && sectionTag !== "other") return idx;
	// Custom headings (sectionTag=other but has headingText) come after standard sections
	return SECTION_ORDER.length;
}

export function renderReport(anchors: PdfAnchor[]): string {
	if (anchors.length === 0) return "";

	// Group by heading text (or sectionTag fallback), preserving appearance order
	const groupOrder: string[] = [];
	const groups = new Map<string, PdfAnchor[]>();

	for (const anchor of anchors) {
		const key = groupKey(anchor);
		if (!groups.has(key)) {
			groupOrder.push(key);
			groups.set(key, []);
		}
		groups.get(key)!.push(anchor);
	}

	// Sort groups: standard sections first (by SECTION_ORDER), custom headings after (by appearance)
	const sortedKeys = groupOrder.slice().sort((a, b) => {
		const anchorsA = groups.get(a)!;
		const anchorsB = groups.get(b)!;
		const tagA = anchorsA[0]!.sectionTag;
		const tagB = anchorsB[0]!.sectionTag;
		const prioA = groupSortKey(a, tagA);
		const prioB = groupSortKey(b, tagB);
		if (prioA !== prioB) return prioA - prioB;
		// Same priority: preserve appearance order
		return groupOrder.indexOf(a) - groupOrder.indexOf(b);
	});

	const lines: string[] = ["", "---", "", "## AI 精读报告"];

	for (const key of sortedKeys) {
		const entries = groups.get(key)!;
		if (entries.length === 0) continue;

		const label = groupLabel(entries[0]!);
		lines.push("", `### ${label}`);
		for (const entry of entries) {
			lines.push(`- **[${entry.type}]** ${entry.markdownLink}  \n  ${entry.exact_text}`);
		}
	}

	return lines.join("\n");
}

export async function appendReport(
	app: App,
	noteFile: TFile,
	anchors: PdfAnchor[]
): Promise<void> {
	const markdown = renderReport(anchors);
	if (!markdown) return;
	await app.vault.adapter.append(noteFile.path, markdown);
}
