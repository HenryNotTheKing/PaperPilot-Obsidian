import { describe, expect, it } from "vitest";
import {
	DEFAULT_SUMMARY_EXTREAM_PROMPT,
	DEFAULT_SUMMARY_EXTREAM_PROMPT_ZH,
	DEFAULT_SUMMARY_HIGH_PROMPT,
	DEFAULT_SUMMARY_HIGH_PROMPT_ZH,
	DEFAULT_SUMMARY_LOW_PROMPT,
	DEFAULT_SUMMARY_LOW_PROMPT_ZH,
	DEFAULT_SUMMARY_MEDIUM_PROMPT,
	DEFAULT_SUMMARY_MEDIUM_PROMPT_ZH,
	getDefaultSummaryPrompt,
} from "../src/prompts";
import { normalizeLlmProvider, normalizeSummaryEffort } from "../src/types";

describe("normalizeLlmProvider", () => {
	it("accepts supported provider values", () => {
		expect(normalizeLlmProvider("auto")).toBe("auto");
		expect(normalizeLlmProvider("openai")).toBe("openai");
		expect(normalizeLlmProvider("anthropic")).toBe("anthropic");
	});

	it("falls back for invalid values", () => {
		expect(normalizeLlmProvider("unknown")).toBe("auto");
		expect(normalizeLlmProvider("unknown", "anthropic")).toBe("anthropic");
	});
});

describe("normalizeSummaryEffort", () => {
	it("accepts low, medium, high, and extream", () => {
		expect(normalizeSummaryEffort("low")).toBe("low");
		expect(normalizeSummaryEffort("medium")).toBe("medium");
		expect(normalizeSummaryEffort("high")).toBe("high");
		expect(normalizeSummaryEffort("extream")).toBe("extream");
	});

	it("falls back to the provided default for invalid values", () => {
		expect(normalizeSummaryEffort("unknown")).toBe("medium");
		expect(normalizeSummaryEffort("unknown", "high")).toBe("high");
	});
});

describe("default summary prompts", () => {
	it("ship non-empty prompt defaults for all effort levels", () => {
		expect(DEFAULT_SUMMARY_LOW_PROMPT.length).toBeGreaterThan(40);
		expect(DEFAULT_SUMMARY_MEDIUM_PROMPT).toContain("## TL;DR");
		expect(DEFAULT_SUMMARY_HIGH_PROMPT).toContain(
			"## Formula and mechanism explanation"
		);
		expect(DEFAULT_SUMMARY_EXTREAM_PROMPT).toContain("## Limitations and open questions");
	});

	it("ship localized Chinese prompt defaults for all effort levels", () => {
		expect(DEFAULT_SUMMARY_LOW_PROMPT_ZH).toContain("简体中文");
		expect(DEFAULT_SUMMARY_MEDIUM_PROMPT_ZH).toContain("## 速览");
		expect(DEFAULT_SUMMARY_HIGH_PROMPT_ZH).toContain("## 公式与机制解释");
		expect(DEFAULT_SUMMARY_EXTREAM_PROMPT_ZH).toContain("## 局限与开放问题");
	});

	it("returns prompt defaults by locale and effort", () => {
		expect(getDefaultSummaryPrompt("en", "low")).toBe(DEFAULT_SUMMARY_LOW_PROMPT);
		expect(getDefaultSummaryPrompt("zh-CN", "medium")).toBe(
			DEFAULT_SUMMARY_MEDIUM_PROMPT_ZH
		);
		expect(getDefaultSummaryPrompt("en", "extream")).toBe(
			DEFAULT_SUMMARY_EXTREAM_PROMPT
		);
	});
});