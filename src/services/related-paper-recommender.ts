import type { LlmConfig, PaperMeta } from "../types";
import type { PaperAnalyzerSettings } from "../settings";
import { callLlmText } from "./llm-client";
import { fetchCitations, fetchReferences } from "./openalex-client";
import { computeSimilarity } from "./tfidf-ranker";

const FETCH_LIMIT = 25;
const PRESELECT_LIMIT = 15;
const FINAL_LIMIT = 5;

export interface RelatedPaperRecommendation {
	paperId: string;
	title: string;
	url: string;
	reason: string;
}

export interface RelatedPaperRecommenderInput {
	paperId: string;
	paperTitle: string;
	paperAbstract: string;
	settings: PaperAnalyzerSettings;
	llmConfig: LlmConfig;
	signal?: AbortSignal;
}

export async function recommendRelatedPapers(
	input: RelatedPaperRecommenderInput
): Promise<string> {
	const { paperId, paperTitle, paperAbstract, settings, llmConfig, signal } = input;
	const apiKey = settings.citationSidebar?.semanticScholarApiKey ?? "";

	const [citations, references] = await Promise.all([
		fetchCitations(paperId, FETCH_LIMIT, apiKey),
		fetchReferences(paperId, FETCH_LIMIT, apiKey),
	]);

	const candidatesById = new Map<string, PaperMeta>();
	for (const candidate of [...citations, ...references]) {
		if (!candidate.id || !candidate.abstract) continue;
		if (candidate.id === paperId) continue;
		if (!candidatesById.has(candidate.id)) {
			candidatesById.set(candidate.id, candidate);
		}
	}

	const candidates = [...candidatesById.values()];
	if (candidates.length === 0) {
		return renderEmptyRecommendation(settings.language);
	}

	const query = `${paperTitle}\n\n${paperAbstract}`.trim();
	const corpus = candidates.map((c) => `${c.title}\n${c.abstract}`);
	const similarities = computeSimilarity(query, corpus);

	const ranked = candidates
		.map((candidate, index) => ({
			candidate,
			score: similarities[index] ?? 0,
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, PRESELECT_LIMIT)
		.map((entry) => entry.candidate);

	const picked = await pickRecommendationsWithLlm({
		llmConfig,
		settings,
		paperTitle,
		paperAbstract,
		candidates: ranked,
		signal,
	});

	if (picked.length === 0) {
		// Fall back to top similarity entries with heuristic reasons so the
		// reader still gets a "why read this" hint even when the LLM picker
		// fails or refuses to produce reasons.
		return renderRecommendationSection(
			ranked.slice(0, FINAL_LIMIT).map((c) => ({
				paperId: c.id,
				title: c.title,
				url: c.url,
				reason: buildHeuristicReason(c, settings.language),
			})),
			settings.language
		);
	}

	return renderRecommendationSection(picked, settings.language);
}

function buildHeuristicReason(
	candidate: PaperMeta,
	language: PaperAnalyzerSettings["language"]
): string {
	const abstract = candidate.abstract.trim();
	if (!abstract) {
		return language === "zh-CN"
			? "与目标论文存在引用关系，主题相近。"
			: "Cited by / referenced from the target paper with overlapping topic.";
	}
	const firstSentence =
		abstract.match(/^[^.!?。！？\n]{20,260}[.!?。！？]/)?.[0] ?? abstract.slice(0, 220);
	return firstSentence.trim();
}

interface LlmPickInput {
	llmConfig: LlmConfig;
	settings: PaperAnalyzerSettings;
	paperTitle: string;
	paperAbstract: string;
	candidates: PaperMeta[];
	signal?: AbortSignal;
}

async function pickRecommendationsWithLlm(
	input: LlmPickInput
): Promise<RelatedPaperRecommendation[]> {
	const { llmConfig, settings, paperTitle, paperAbstract, candidates, signal } = input;
	const candidateMap = new Map(candidates.map((c) => [c.id, c]));
	const candidateBlock = candidates
		.map((c, index) => {
			const authors = c.authors.slice(0, 3).join(", ");
			const year = c.year ? ` (${c.year})` : "";
			return [
				`[${index + 1}] id=${c.id}`,
				`title: ${c.title}${year}`,
				authors ? `authors: ${authors}` : "",
				`abstract: ${c.abstract}`,
			]
				.filter(Boolean)
				.join("\n");
		})
		.join("\n\n");

	const systemPrompt = getRelatedPaperPickerPrompt(settings);
	const userContent =
		settings.language === "zh-CN"
			? [
					`目标论文标题: ${paperTitle}`,
					`目标论文摘要: ${paperAbstract}`,
					`从下列候选中挑选最相关的 ${FINAL_LIMIT} 篇:`,
					candidateBlock,
					"严格只返回 JSON：{\"recommendations\":[{\"paperId\":string,\"reason\":string}]}",
			  ].join("\n\n")
			: [
					`Target paper title: ${paperTitle}`,
					`Target paper abstract: ${paperAbstract}`,
					`Pick the ${FINAL_LIMIT} most relevant entries from the candidates below:`,
					candidateBlock,
					"Return JSON only: {\"recommendations\":[{\"paperId\":string,\"reason\":string}]}",
			  ].join("\n\n");

	let rawText = "";
	try {
		rawText = await callLlmText(llmConfig, systemPrompt, userContent, signal, {
			responseMode: "json",
			maxTokens: 1200,
			temperature: 0.2,
		});
	} catch {
		return [];
	}

	const parsed = safeParseRecommendations(rawText);
	const recommendations: RelatedPaperRecommendation[] = [];
	for (const entry of parsed) {
		const candidate = candidateMap.get(entry.paperId);
		if (!candidate) continue;
		// Guarantee a non-empty reason even if the model returned an empty
		// or whitespace-only string — fall back to a heuristic derived from
		// the candidate's abstract.
		const trimmedReason = entry.reason.trim();
		const reason =
			trimmedReason.length >= 8
				? trimmedReason
				: buildHeuristicReason(candidate, settings.language);
		recommendations.push({
			paperId: candidate.id,
			title: candidate.title,
			url: candidate.url,
			reason,
		});
		if (recommendations.length >= FINAL_LIMIT) break;
	}
	return recommendations;
}

function safeParseRecommendations(rawText: string): Array<{ paperId: string; reason: string }> {
	const trimmed = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
	try {
		const value = JSON.parse(trimmed) as { recommendations?: unknown };
		if (!value || !Array.isArray(value.recommendations)) return [];
		return value.recommendations
			.map((entry) => {
				const record = entry as { paperId?: unknown; reason?: unknown };
				const paperId = typeof record.paperId === "string" ? record.paperId.trim() : "";
				const reason = typeof record.reason === "string" ? record.reason.trim() : "";
				if (!paperId) return null;
				return { paperId, reason };
			})
			.filter((entry): entry is { paperId: string; reason: string } => entry !== null);
	} catch {
		return [];
	}
}

function getRelatedPaperPickerPrompt(settings: PaperAnalyzerSettings): string {
	if (settings.language === "zh-CN") {
		return [
			"你是一名科研助手。给定目标论文摘要和一组候选（来自该论文的引用与被引用），请挑出与目标论文最相关、对读者最有帮助的 5 篇。",
			"评判标准：是否解决相近问题、是否提供必要背景、是否是直接前置工作、是否拓展或对比该方法。",
			"硬性规则：每条 reason 必须是 1 到 2 句具体说明，至少 20 个字符；明确指出它与目标论文的关系（前置 / 后续 / 对比 / 背景）以及读者读它的收益。禁止留空、禁止只写「相关」「相似」之类的空话。",
			"只返回严格 JSON：{\"recommendations\":[{\"paperId\":string,\"reason\":string}]}",
			"输出语言：简体中文。不要进入思考模式，不要输出 <think> 标签或任何过程性文本。",
		].join("\n\n");
	}
	return [
		"You are a research assistant. Given a target paper's abstract and a set of candidates drawn from its citations and references, pick the 5 most relevant and most useful for the reader.",
		"Judge by: addresses a similar problem, provides necessary background, is a direct predecessor, or extends/contrasts the same method.",
		"Hard rule: every reason MUST be 1 to 2 concrete sentences (>= 20 characters). Explicitly state how the candidate relates to the target paper (predecessor / follow-up / contrast / background) AND what the reader will gain. Do NOT leave reason empty or write vague phrases like \"related work\" or \"similar topic\".",
		"Return strict JSON only: {\"recommendations\":[{\"paperId\":string,\"reason\":string}]}",
		"Output language: English. Do not enter thinking mode. Do not emit <think> tags or any chain-of-thought.",
	].join("\n\n");
}

function renderRecommendationSection(
	recommendations: RelatedPaperRecommendation[],
	language: PaperAnalyzerSettings["language"]
): string {
	const heading = language === "zh-CN" ? "## 推荐阅读" : "## Recommended reading";
	if (recommendations.length === 0) {
		return renderEmptyRecommendation(language);
	}
	const lines = recommendations.map((rec) => {
		const link = rec.url ? `[${rec.title}](${rec.url})` : rec.title;
		return rec.reason ? `- ${link} — ${rec.reason}` : `- ${link}`;
	});
	return [heading, ...lines].join("\n");
}

function renderEmptyRecommendation(language: PaperAnalyzerSettings["language"]): string {
	const heading = language === "zh-CN" ? "## 推荐阅读" : "## Recommended reading";
	const note =
		language === "zh-CN"
			? "未能获取到与该论文足够相关的引用或被引用记录。"
			: "Could not retrieve sufficiently related citations or references for this paper.";
	return `${heading}\n${note}`;
}
