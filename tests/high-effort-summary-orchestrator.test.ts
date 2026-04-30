import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/huggingface-paper-client", () => ({
	buildHighEffortSourceBundle: vi.fn(),
}));

vi.mock("../src/services/llm-client", () => ({
	callLlmText: vi.fn(),
	callLlmTextWithMeta: vi.fn(),
}));

import { runHighEffortSummaryOrchestrator } from "../src/services/high-effort-summary-orchestrator";
import { buildHighEffortSourceBundle } from "../src/services/huggingface-paper-client";
import { callLlmText, callLlmTextWithMeta } from "../src/services/llm-client";

const baseBundle = {
	paperTitle: "AURA",
	markdown: "# AURA",
	sourceKind: "huggingface-markdown",
	sourceLabel: "Hugging Face paper markdown",
	attempts: [],
	sectionPointers: [
		{
			id: "section:intro",
			kind: "section",
			ordinal: 1,
			sectionPath: ["AURA", "Introduction"],
			excerpt: "Introduces the research problem and motivation.",
			lineStart: 1,
			lineEnd: 8,
			charStart: 0,
			charEnd: 120,
			contentHash: "introhash",
			content: "The paper introduces the research problem, motivation, and background.",
		},
		{
			id: "section:method",
			kind: "section",
			ordinal: 2,
			sectionPath: ["AURA", "Method"],
			excerpt: "Describes the architecture and training strategy.",
			lineStart: 9,
			lineEnd: 20,
			charStart: 121,
			charEnd: 260,
			contentHash: "methodhash",
			content: "The method section describes the architecture, modules, and training logic.",
		},
		{
			id: "section:experiments",
			kind: "section",
			ordinal: 3,
			sectionPath: ["AURA", "Experiments"],
			excerpt: "Covers datasets, evaluation, and ablations.",
			lineStart: 21,
			lineEnd: 34,
			charStart: 261,
			charEnd: 420,
			contentHash: "experimentshash",
			content: "The experiments section covers datasets, evaluation metrics, baselines, and ablations.",
		},
		{
			id: "section:conclusion",
			kind: "section",
			ordinal: 4,
			sectionPath: ["AURA", "Conclusion"],
			excerpt: "Summarizes results and mentions limitations.",
			lineStart: 35,
			lineEnd: 44,
			charStart: 421,
			charEnd: 560,
			contentHash: "conclusionhash",
			content: "The conclusion summarizes the main results, discusses evidence strength, and notes current limitations and open questions.",
		},
	],
	paragraphPointers: [],
	formulaPointers: [
		{
			id: "formula:main",
			kind: "formula",
			ordinal: 1,
			sectionPath: ["AURA", "Method"],
			excerpt: "Main token sampling formula.",
			lineStart: 14,
			lineEnd: 16,
			charStart: 210,
			charEnd: 320,
			contentHash: "formulahash",
			content: "$$\\widetilde{V}=[\\bm{\\tilde{v}_{1}},\\bm{\\tilde{v}_{K}}]$$",
		},
	],
	imagePointers: [],
} as const;

const zhSettings = {
	language: "zh-CN",
	summaryHighPrompt: "English high prompt",
	summaryHighPromptZh: "中文高强度提示词补充",
	highEffortReviewEnabled: false,
	llmConcurrency: 4,
} as const;

beforeEach(() => {
	vi.mocked(buildHighEffortSourceBundle).mockReset();
	vi.mocked(callLlmText).mockReset();
	vi.mocked(callLlmTextWithMeta).mockReset();
});

describe("runHighEffortSummaryOrchestrator", () => {
	it("forces Chinese prompts and backfills missing late tutorial sections", async () => {
		vi.mocked(buildHighEffortSourceBundle).mockResolvedValue(baseBundle as never);
		vi.mocked(callLlmTextWithMeta).mockImplementation(async (_config, systemPrompt) => ({
			text: JSON.stringify({
				markdown: "> [!note]\n正式讲解内容。",
				figureMentions: [],
				figureNote: "",
			}),
			stopReason: "stop",
			truncated: false,
		}));

		const content = await runHighEffortSummaryOrchestrator({
			app: {} as never,
			pdfFile: { basename: "AURA" } as never,
			noteFile: { basename: "AURA" } as never,
			arxivId: "2604.04184",
			settings: zhSettings as never,
			config: {
				baseUrl: "https://api.example.com/v1",
				apiKey: "sk-test",
				model: "summary-model",
				provider: "openai",
				concurrencyLimit: 4,
			},
		});

		expect(vi.mocked(callLlmTextWithMeta).mock.calls.length).toBeGreaterThanOrEqual(5);
		expect(
			vi.mocked(callLlmTextWithMeta).mock.calls.some(([, systemPrompt]) =>
				systemPrompt.includes("科研教程策划助手")
			)
		).toBe(false);
		for (const [, systemPrompt] of vi.mocked(callLlmTextWithMeta).mock.calls) {
			expect(systemPrompt).toContain("简体中文");
			expect(systemPrompt).toContain("不要进入思考模式");
		}
		expect(content).toContain("## 实验流程与证据");
		expect(content).toContain("## 实验流程与证据\n### Experiments");
		expect(content).toContain("## 结果与启示");
		expect(content).toContain("## 结果与启示\n### Conclusion");
		expect(content).toContain("## 局限与开放问题");
		expect(content).toContain("## 局限与开放问题\n### Conclusion");
		expect(content).toContain("> [!note]");
	});

	it("repairs leaked source text and bare formulas instead of pasting raw pointers", async () => {
		vi.mocked(buildHighEffortSourceBundle).mockResolvedValue(baseBundle as never);
		vi.mocked(callLlmTextWithMeta).mockImplementation(async (_config, systemPrompt, userContent) => {
			if (systemPrompt.includes("科研导师")) {
				return {
					text: JSON.stringify({
						markdown:
							"Video large language models (Vid-LLMs) are typically implemented with uniform sampling, which can dilute temporal evidence.",
						figureMentions: ["Figure 2"],
						figureNote: "",
					}),
					stopReason: "stop",
					truncated: false,
				};
			}

			if (systemPrompt.includes("修复一段不合格的科研教程章节输出")) {
				return {
					text: [
						"```json",
						JSON.stringify({
							markdown: [
								"研究问题的关键不在于一般视频理解，而在于能否根据文本查询精确定位时间片段。",
								"现有 Vid-LLM 的主要瓶颈是均匀采样会稀释关键时刻的视觉证据，因此需要更聚焦的时序建模。",
							].join("\n\n"),
						}),
						"```",
					].join("\n"),
					stopReason: "stop",
					truncated: false,
				};
			}

			if (systemPrompt.includes("科研数学讲解助手")) {
				return {
					text: JSON.stringify({ markdown: "$$\\bm{\\tilde{v}_{i}}$$" }),
					stopReason: "stop",
					truncated: false,
				};
			}

			if (systemPrompt.includes("修复一段不合格的公式讲解输出")) {
				return {
					text: [
						"```json",
						JSON.stringify({
							markdown: [
								"$$\\bm{\\tilde{v}_{i}}=\\hat{w}_{i}\\cdot \\operatorname{MLP}(\\boldsymbol{v}_{i})$$",
								"> [!note] 变量说明",
								"> - $\\hat{w}_{i}$ 表示重归一化后的 token 权重。",
								"> - $\\tilde{v}_{i}$ 表示被保留下来的查询相关视觉 token 表示。",
								"这条公式说明 GroundVTS 会按照查询相关性重新组织视觉信息，而不是简单丢弃 token。",
							].join("\n\n"),
						}),
						"```",
					].join("\n"),
					stopReason: "stop",
					truncated: false,
				};
			}

			if (userContent.includes("当前草稿")) {
				return {
					text: JSON.stringify({ revisionRequests: [] }),
					stopReason: "stop",
					truncated: false,
				};
			}

			return {
				text: JSON.stringify({ markdown: "正式讲解内容。", figureMentions: [], figureNote: "" }),
				stopReason: "stop",
				truncated: false,
			};
		});

		const content = await runHighEffortSummaryOrchestrator({
			app: {} as never,
			pdfFile: { basename: "AURA" } as never,
			noteFile: { basename: "AURA" } as never,
			arxivId: "2604.04184",
			settings: {
				...zhSettings,
				highEffortReviewEnabled: true,
			} as never,
			config: {
				baseUrl: "https://api.example.com/v1",
				apiKey: "sk-test",
				model: "summary-model",
				provider: "openai",
				concurrencyLimit: 4,
			},
		});

		expect(content).toContain("## 研究问题");
		expect(
			vi.mocked(callLlmTextWithMeta).mock.calls.some(([, systemPrompt]) =>
				systemPrompt.includes("科研教程策划助手")
			)
		).toBe(false);
		expect(content).not.toContain("```json");
		expect(content).not.toContain('"markdown":');
		expect(content).not.toContain("Video large language models (Vid-LLMs) are typically implemented");
		expect(content).not.toContain("## 研究问题\n## 研究问题");
		expect(content).toContain("研究问题的关键不在于一般视频理解");
		expect(content).toContain("公式与机制解释");
		expect(content).toContain("变量说明");
		expect(content).not.toContain("\\bm");
		expect(content).toContain("\\boldsymbol{\\tilde{v}_{i}}");
	});

	it("retries truncated json responses with a larger token budget", async () => {
		vi.mocked(buildHighEffortSourceBundle).mockResolvedValue(baseBundle as never);
		let firstSectionAttempt = true;
		vi.mocked(callLlmTextWithMeta).mockImplementation(async (_config, systemPrompt, _userContent, _signal, options) => {
			if (
				systemPrompt.includes("科研导师") &&
				firstSectionAttempt &&
				options?.maxTokens === 1100
			) {
				firstSectionAttempt = false;

			if (systemPrompt.includes("科研数学讲解助手")) {
				return {
					text: JSON.stringify({
						markdown: [
							"$$\\widetilde{V}=\\operatorname{VTS}(V,Q)$$",
							"> [!note] 变量说明",
							"> - $V$ 是输入视觉 token 序列。",
							"> - $Q$ 是文本查询表示。",
							"这条公式说明模型会根据查询挑选更相关的视觉 token。",
						].join("\n\n"),
					}),
					stopReason: "stop",
					truncated: false,
				};
			}

			if (systemPrompt.includes("修复一段不合格的科研教程章节输出")) {
				return {
					text: "重试后的完整讲解。这里明确说明研究问题、方法逻辑与证据结构，从而满足最小长度要求。",
					stopReason: "stop",
					truncated: false,
				};
			}
				return {
					text: '```json\n{"markdown":"半截讲解',
					stopReason: "length",
					markdown:
						"重试后的完整讲解。这里明确说明研究问题、方法逻辑与证据结构，从而满足最小长度要求。",
				};
			}

			return {
				text: JSON.stringify({
					markdown: "> [!note]\n重试后的完整讲解。",
					figureMentions: [],
					figureNote: "",
				}),
				stopReason: "stop",
				truncated: false,
			};
		});

		const content = await runHighEffortSummaryOrchestrator({
			app: {} as never,
			pdfFile: { basename: "AURA" } as never,
			noteFile: { basename: "AURA" } as never,
			arxivId: "2604.04184",
			settings: zhSettings as never,
			config: {
				baseUrl: "https://api.example.com/v1",
				apiKey: "sk-test",
				model: "summary-model",
				provider: "openai",
				concurrencyLimit: 4,
			},
		});

		expect(content).not.toContain("```json");
		expect(content).not.toContain('"markdown":');
		expect(
			vi.mocked(callLlmTextWithMeta).mock.calls.some(
				([, systemPrompt, , , options]) =>
					systemPrompt.includes("科研导师") && options?.maxTokens === 2200
			)
		).toBe(true);
	});
});