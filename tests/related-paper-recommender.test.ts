import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { recommendRelatedPapers } from "../src/services/related-paper-recommender";
import { DEFAULT_SETTINGS } from "../src/settings";
import type { LlmConfig } from "../src/types";

const requestUrlMock = vi.mocked(requestUrl);

const llmConfig: LlmConfig = {
	provider: "openai",
	baseUrl: "https://example.com/v1",
	apiKey: "test-key",
	model: "test-model",
	temperature: 0.2,
};

function s2Paper(id: string, title: string, abstract: string) {
	return {
		paperId: id,
		title,
		authors: [{ authorId: null, name: "Author" }],
		year: 2024,
		abstract,
		citationCount: 0,
		openAccessPdf: null,
		externalIds: null,
	};
}

beforeEach(() => {
	requestUrlMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("recommendRelatedPapers", () => {
	it("returns empty-state markdown when no candidates are returned", async () => {
		requestUrlMock.mockImplementation(() =>
			Promise.resolve({
				status: 200,
				text: "{}",
				json: { data: [] },
				headers: {},
			}) as never
		);

		const result = await recommendRelatedPapers({
			paperId: "arxiv:2401.00001",
			paperTitle: "Test Paper",
			paperAbstract: "Some abstract.",
			settings: { ...DEFAULT_SETTINGS, language: "en" },
			llmConfig,
		});

		expect(result).toContain("## Recommended reading");
		expect(result).toMatch(/Could not retrieve|sufficiently/i);
	});

	it("renders recommendations from LLM picks with reasons", async () => {
		// First call: citations. Second call: references. Third call: LLM.
		const citationData = {
			data: [
				{ citingPaper: s2Paper("c1", "Citing One", "Talks about transformer attention.") },
				{ citingPaper: s2Paper("c2", "Citing Two", "Unrelated topic about cooking.") },
			],
		};
		const referenceData = {
			data: [
				{ citedPaper: s2Paper("r1", "Reference One", "Foundations of attention.") },
			],
		};
		requestUrlMock
			.mockResolvedValueOnce({
				status: 200,
				text: "",
				json: citationData,
				headers: {},
			} as never)
			.mockResolvedValueOnce({
				status: 200,
				text: "",
				json: referenceData,
				headers: {},
			} as never)
			.mockResolvedValueOnce({
				status: 200,
				text: JSON.stringify({
					choices: [
						{
							message: {
								content: JSON.stringify({
									recommendations: [
										{ paperId: "c1", reason: "Direct extension of attention." },
										{ paperId: "r1", reason: "Foundational background." },
									],
								}),
							},
						},
					],
				}),
				json: {
					choices: [
						{
							message: {
								content: JSON.stringify({
									recommendations: [
										{ paperId: "c1", reason: "Direct extension of attention." },
										{ paperId: "r1", reason: "Foundational background." },
									],
								}),
							},
						},
					],
				},
				headers: {},
			} as never);

		const result = await recommendRelatedPapers({
			paperId: "arxiv:2401.00001",
			paperTitle: "Attention Paper",
			paperAbstract: "We study attention mechanisms in detail.",
			settings: { ...DEFAULT_SETTINGS, language: "en" },
			llmConfig,
		});

		expect(result).toContain("## Recommended reading");
		expect(result).toContain("Citing One");
		expect(result).toContain("Reference One");
		expect(result).toContain("Direct extension of attention.");
	});

	it("uses zh-CN heading and language when language is zh-CN", async () => {
		requestUrlMock.mockImplementation(() =>
			Promise.resolve({
				status: 200,
				text: "{}",
				json: { data: [] },
				headers: {},
			}) as never
		);

		const result = await recommendRelatedPapers({
			paperId: "arxiv:2401.00001",
			paperTitle: "测试论文",
			paperAbstract: "摘要内容。",
			settings: { ...DEFAULT_SETTINGS, language: "zh-CN" },
			llmConfig,
		});

		expect(result).toContain("## 推荐阅读");
	});
});
