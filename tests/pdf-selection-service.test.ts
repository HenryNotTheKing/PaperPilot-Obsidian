import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => {
	const actual = await vi.importActual<typeof import("obsidian")>("obsidian");
	class MockFileView {
		file = null;
		containerEl = document.createElement("div");
	}
	class MockComponent {
		load(): void {}
		unload(): void {}
	}
	return {
		...actual,
		FileView: MockFileView,
		Component: MockComponent,
		MarkdownRenderer: { render: vi.fn() },
		setIcon: vi.fn(),
	};
});

vi.mock("../src/ui/pdf-selection-popup", () => ({
	PdfSelectionPopup: class {
		create = vi.fn();
		resetForStreaming = vi.fn();
		updateText = vi.fn();
		finalize = vi.fn();
		setError = vi.fn();
		destroy = vi.fn();
	},
}));

vi.mock("../src/services/pdf-explanation-client", () => ({
	callLlmStream: vi.fn(),
}));

vi.mock("../src/services/pdf-parser", () => ({
	parsePdf: vi.fn(),
}));

import {
	buildUserPrompt,
	getContextWindowForMode,
	PdfSelectionService,
	resolveSelectionActionFromKeyboardEvent,
} from "../src/services/pdf-selection-service";
import { FileView } from "obsidian";
import { callLlmStream } from "../src/services/pdf-explanation-client";
import { parsePdf } from "../src/services/pdf-parser";

const callLlmStreamMock = vi.mocked(callLlmStream);
const parsePdfMock = vi.mocked(parsePdf);

function createSelectionWithPdfContext(selectedText: string): HTMLElement {
	document.body.innerHTML = "";
	const leaf = document.createElement("div");
	leaf.className = "workspace-leaf-content";
	const viewer = document.createElement("div");
	viewer.className = "pdfViewer";
	const page = document.createElement("div");
	page.className = "page";
	const span = document.createElement("span");
	span.textContent = selectedText;
	page.appendChild(span);
	viewer.appendChild(page);
	leaf.appendChild(viewer);
	document.body.appendChild(leaf);

	const textNode = span.firstChild;
	if (!textNode) throw new Error("Expected a text node for selection test setup");

	const range = document.createRange();
	range.setStart(textNode, 0);
	range.setEnd(textNode, selectedText.length);
	Object.defineProperty(range, "getBoundingClientRect", {
		value: () => ({
			width: 60,
			height: 18,
			top: 24,
			left: 40,
			right: 100,
			bottom: 42,
			x: 40,
			y: 24,
			toJSON: () => ({}),
		}) as DOMRect,
	});

	vi.spyOn(window, "getSelection").mockReturnValue({
		rangeCount: 1,
		toString: () => selectedText,
		getRangeAt: () => range,
	} as Selection);

	return leaf;
}

beforeEach(() => {
	callLlmStreamMock.mockReset();
	parsePdfMock.mockReset();
	document.body.innerHTML = "";
});

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

describe("pdf selection action routing", () => {
	it("maps Shift+T to translate and Shift+E to elaborate", () => {
		expect(
			resolveSelectionActionFromKeyboardEvent({ shiftKey: true, key: "t" })
		).toBe("translate");
		expect(
			resolveSelectionActionFromKeyboardEvent({ shiftKey: true, key: "E" })
		).toBe("elaborate");
		expect(
			resolveSelectionActionFromKeyboardEvent({ shiftKey: false, key: "e" })
		).toBeNull();
	});

	it("uses the base context window for translate and a larger window for elaborate", () => {
		expect(getContextWindowForMode("translate", 500)).toBe(500);
		expect(getContextWindowForMode("elaborate", 500)).toBe(1500);
	});

	it("builds a richer elaborate prompt than translate", () => {
		const translatePrompt = buildUserPrompt(
			"translate",
			"word",
			"diffusion prior",
			"paper context"
		);
		const elaboratePrompt = buildUserPrompt(
			"elaborate",
			"paragraph",
			"diffusion prior",
			"paper context"
		);

		expect(translatePrompt).toContain("简要解释");
		expect(elaboratePrompt).toContain("详细");
		expect(elaboratePrompt).toContain("Markdown");
		expect(elaboratePrompt).toContain("小标题");
		expect(elaboratePrompt).toContain("作者想表达");
		expect(elaboratePrompt).toContain("paper context");
	});

	it("uses elaborate prompt and expanded context when explicitly requested", async () => {
		const leaf = createSelectionWithPdfContext("KEY");
		const view = new FileView() as FileView & {
			file: { path: string; extension: string };
			containerEl: HTMLElement;
		};
		view.file = { path: "Papers/PDFs/test.pdf", extension: "pdf" };
		view.containerEl = leaf;

		parsePdfMock.mockResolvedValue([
			{ fullText: "LEFT-LONG-CONTEXT KEY RIGHT-LONG-CONTEXT" },
		] as Awaited<ReturnType<typeof parsePdf>>);
		callLlmStreamMock.mockResolvedValue(undefined);

		const service = new PdfSelectionService(
			{
				workspace: {
					iterateAllLeaves: (callback: (leafRef: { view: FileView }) => void) => {
						callback({ view });
					},
				},
			} as never,
			() => ({
				extractionBaseUrl: "https://example.com/v1",
				extractionApiKey: "sk-test",
				extractionModel: "test-model",
				extractionProvider: "openai",
				explanationContextWindow: 7,
			}) as never
		);

		await (service as { handleExplainRequest: (action: "elaborate") => Promise<void> }).handleExplainRequest("elaborate");

		expect(callLlmStreamMock).toHaveBeenCalledTimes(1);
		const userPrompt = callLlmStreamMock.mock.calls[0]?.[2];
		expect(userPrompt).toContain("详细理解");
		expect(userPrompt).toContain("Markdown");
		expect(userPrompt).toContain("LEFT-LONG-CONTEXT");
	});
});
