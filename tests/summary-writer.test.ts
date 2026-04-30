import { describe, expect, it } from "vitest";
import {
	renderSummaryBlock,
	SUMMARY_BLOCK_END,
	SUMMARY_BLOCK_START,
	upsertSummaryBlock,
} from "../src/services/summary-writer";

describe("renderSummaryBlock", () => {
	it("renders a managed summary block with metadata", () => {
		const output = renderSummaryBlock({
			effort: "medium",
			model: "gpt-4.1-mini",
			generatedAt: "2026-04-21T15:00:00.000Z",
			content: "A structured summary body.",
		});

		expect(output).toContain(SUMMARY_BLOCK_START);
		expect(output).toContain("## AI Summary");
		expect(output).toContain("- Effort: medium");
		expect(output).toContain("- Model: gpt-4.1-mini");
		expect(output).toContain("- Generated: 2026-04-21T15:00:00.000Z");
		expect(output).toContain("A structured summary body.");
		expect(output).toContain(SUMMARY_BLOCK_END);
	});

	it("returns empty string when summary content is blank", () => {
		expect(
			renderSummaryBlock({
				effort: "low",
				model: "test-model",
				content: "   ",
			})
		).toBe("");
	});

		it("localizes the managed summary block labels for Chinese", () => {
			const output = renderSummaryBlock({
				effort: "medium",
				model: "qwen3.5-plus",
				generatedAt: "2026-04-21T15:00:00.000Z",
				content: "一段中文总结。",
				locale: "zh-CN",
			});

			expect(output).toContain("## AI 总结");
			expect(output).toContain("- 强度: medium");
			expect(output).toContain("- 模型: qwen3.5-plus");
			expect(output).toContain("- 生成时间: 2026-04-21T15:00:00.000Z");
		});
});

describe("upsertSummaryBlock", () => {
	it("appends a managed block when none exists", () => {
		const note = "# Paper Note\n\nSome existing content.";
		const next = upsertSummaryBlock(note, {
			effort: "low",
			model: "model-a",
			generatedAt: "2026-04-21T15:00:00.000Z",
			content: "One paragraph summary.",
		});

		expect(next).toContain("Some existing content.");
		expect(next).toContain("One paragraph summary.");
		expect(next.indexOf(SUMMARY_BLOCK_START)).toBeGreaterThan(
			note.indexOf("Some existing content.")
		);
	});

	it("replaces the existing managed block instead of appending a duplicate", () => {
		const original = [
			"# Paper Note",
			"",
			SUMMARY_BLOCK_START,
			"## AI Summary",
			"- Effort: low",
			"- Model: old-model",
			"- Generated: 2026-04-20T10:00:00.000Z",
			"",
			"Old summary.",
			SUMMARY_BLOCK_END,
		].join("\n");

		const next = upsertSummaryBlock(original, {
			effort: "high",
			model: "new-model",
			generatedAt: "2026-04-21T15:00:00.000Z",
			content: "New summary content.",
		});

		expect(next.match(/paper-analyzer-summary:start/g)).toHaveLength(1);
		expect(next).toContain("- Effort: high");
		expect(next).toContain("- Model: new-model");
		expect(next).toContain("New summary content.");
		expect(next).not.toContain("Old summary.");
	});
});