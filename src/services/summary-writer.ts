import type { App, TFile } from "obsidian";
import type { SummaryEffort } from "../types";

type SummaryBlockLocale = "en" | "zh-CN";

export interface SummaryBlockData {
	effort: SummaryEffort;
	model: string;
	content: string;
	generatedAt?: string;
	locale?: SummaryBlockLocale;
}

export const SUMMARY_BLOCK_START = "<!-- paper-analyzer-summary:start -->";
export const SUMMARY_BLOCK_END = "<!-- paper-analyzer-summary:end -->";

const SUMMARY_BLOCK_LABELS: Record<
	SummaryBlockLocale,
	{ title: string; effort: string; model: string; generated: string }
> = {
	en: {
		title: "## AI Summary",
		effort: "Effort",
		model: "Model",
		generated: "Generated",
	},
	"zh-CN": {
		title: "## AI 总结",
		effort: "强度",
		model: "模型",
		generated: "生成时间",
	},
};

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function renderSummaryBlock(summary: SummaryBlockData): string {
	const content = summary.content.trim();
	if (!content) return "";

	const generatedAt = summary.generatedAt ?? new Date().toISOString();
	const model = summary.model.trim() || "unknown";
	const locale = summary.locale === "zh-CN" ? "zh-CN" : "en";
	const labels = SUMMARY_BLOCK_LABELS[locale];

	return [
		SUMMARY_BLOCK_START,
		labels.title,
		`- ${labels.effort}: ${summary.effort}`,
		`- ${labels.model}: ${model}`,
		`- ${labels.generated}: ${generatedAt}`,
		"",
		content,
		SUMMARY_BLOCK_END,
	].join("\n");
}

export function upsertSummaryBlock(
	noteContent: string,
	summary: SummaryBlockData
): string {
	const block = renderSummaryBlock(summary);
	if (!block) return noteContent;

	const managedBlockPattern = new RegExp(
		`${escapeRegExp(SUMMARY_BLOCK_START)}[\\s\\S]*?${escapeRegExp(SUMMARY_BLOCK_END)}`,
		"m"
	);

	if (managedBlockPattern.test(noteContent)) {
		return noteContent.replace(managedBlockPattern, block);
	}

	const trimmed = noteContent.trimEnd();
	if (!trimmed) return `${block}\n`;
	return `${trimmed}\n\n${block}\n`;
}

export async function writeSummaryBlock(
	app: App,
	noteFile: TFile,
	summary: SummaryBlockData
): Promise<void> {
	const current = await app.vault.read(noteFile);
	const next = upsertSummaryBlock(current, summary);
	if (next !== current) {
		await app.vault.modify(noteFile, next);
	}
}