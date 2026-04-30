import { describe, expect, it } from "vitest";
import { getPromptForChunk } from "../src/services/prompt-router";
import type { PaperAnalyzerSettings } from "../src/settings";

const BASE_SETTINGS = {
	language: "en",
	extractionPrompt: "",
} as Pick<PaperAnalyzerSettings, "language" | "extractionPrompt">;

describe("getPromptForChunk", () => {
	it("appends an English no-thinking guard", () => {
		const settings: PaperAnalyzerSettings = {
			...(BASE_SETTINGS as PaperAnalyzerSettings),
			language: "en",
			extractionPrompt: "Base extraction prompt.",
		};

		const prompt = getPromptForChunk({
			pageNum: 1,
			sectionTag: "abstract",
			text: "Chunk content",
			itemRange: [0, 1],
		}, settings);

		expect(prompt).toContain("Base extraction prompt.");
		expect(prompt).toContain("Do not output chain-of-thought");
	});

	it("appends a Chinese no-thinking guard", () => {
		const settings: PaperAnalyzerSettings = {
			...(BASE_SETTINGS as PaperAnalyzerSettings),
			language: "zh-CN",
			extractionPrompt: "基础提取提示词。",
		};

		const prompt = getPromptForChunk({
			pageNum: 1,
			sectionTag: "abstract",
			text: "Chunk content",
			itemRange: [0, 1],
		}, settings);

		expect(prompt).toContain("基础提取提示词。");
		expect(prompt).toContain("不要输出思考过程");
	});
});