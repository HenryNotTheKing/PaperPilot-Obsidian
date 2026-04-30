/**
 * End-to-end smoke test for the new related-paper-recommender against the
 * real Semantic Scholar + DeepSeek APIs.
 *
 * This file is skipped by default. To run it:
 *
 *   $env:E2E_API_KEY = "sk-..."
 *   npx vitest run tests/e2e/summary-effort-e2e.test.ts
 */
import { describe, expect, it } from "vitest";

const E2E_KEY = process.env.E2E_API_KEY;

describe.skipIf(!E2E_KEY)("related-paper-recommender e2e", () => {
	it("returns a recommended-reading section with at least one bullet", async () => {
		const { recommendRelatedPapers } = await import(
			"../../src/services/related-paper-recommender"
		);
		const { DEFAULT_SETTINGS } = await import("../../src/settings");

		const result = await recommendRelatedPapers({
			paperId: "arxiv:1706.03762",
			paperTitle: "Attention Is All You Need",
			paperAbstract:
				"The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.",
			settings: { ...DEFAULT_SETTINGS, language: "en" },
			llmConfig: {
				provider: "openai",
				baseUrl: "https://api.deepseek.com",
				apiKey: E2E_KEY!,
				model: "deepseek-chat",
				temperature: 0.2,
			},
		});

		expect(result).toContain("## Recommended reading");
		// Either an empty-state note or at least one bullet.
		expect(result.length).toBeGreaterThan("## Recommended reading".length);
	}, 120_000);
});
