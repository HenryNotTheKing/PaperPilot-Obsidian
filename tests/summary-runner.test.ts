import { describe, expect, it } from "vitest";
import {
	buildSummarySourceText,
	buildSummarySourceTextFromMarkdown,
} from "../src/services/summary-runner";
import type { PageData } from "../src/services/pdf-parser";

function makePage(pageNum: number, items: Array<{ text: string; height?: number }>): PageData {
	return {
		pageNum,
		items: items.map((item, index) => ({
			text: item.text,
			height: item.height ?? 12,
			pageNum,
			index,
			x: 72,
			y: 720 - index * 14,
			width: Math.max(60, item.text.length * 6),
			fontName: "g_d0_f1",
		})),
		fullText: items.map((item) => item.text).join(" "),
		styles: { g_d0_f1: { fontFamily: "serif", vertical: false } },
	};
}

describe("buildSummarySourceText", () => {
	it("prioritizes key sections for low-effort summaries", () => {
		const pages = [
			makePage(1, [
				{ text: "Abstract", height: 18 },
				{ text: "This paper introduces a compact real-time assistant." },
				{ text: "Introduction", height: 18 },
				{ text: "We study always-on video understanding for assistance." },
			]),
			makePage(2, [
				{ text: "Method", height: 18 },
				{ text: "The model fuses temporal and memory signals." },
				{ text: "Conclusion", height: 18 },
				{ text: "The approach improves latency and usefulness." },
			]),
		];

		const source = buildSummarySourceText({ basename: "AURA" }, pages, "low");
		expect(source).toContain("# AURA");
		expect(source).toContain("### Abstract");
		expect(source).toContain("### Introduction");
		expect(source).toContain("### Conclusion");
	});

	it("falls back to raw page text when chunking yields no sections", () => {
		const pages = [
			makePage(1, [{ text: "Loose text with no obvious heading or section markers." }]),
		];

		const source = buildSummarySourceText({ basename: "Loose Paper" }, pages, "medium");
		expect(source).toContain("# Loose Paper");
		expect(source).toContain("Loose text with no obvious heading");
	});

	it("builds structured summary source text from markdown headings", () => {
		const markdown = [
			"# AURA",
			"## Abstract",
			"Abstract text.",
			"## Introduction",
			"Introduction text.",
			"## Method",
			"Method text.",
			"## Experimental results",
			"Experiment text.",
		].join("\n");

		const source = buildSummarySourceTextFromMarkdown("AURA", markdown, "medium");
		expect(source).toContain("# AURA");
		expect(source).toContain("## AURA > Abstract");
		expect(source).toContain("## AURA > Method");
		expect(source).toContain("## AURA > Experimental results");
	});
});