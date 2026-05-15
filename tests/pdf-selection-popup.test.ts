import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", async () => {
	const actual = await vi.importActual<typeof import("obsidian")>("obsidian");
	class MockComponent {
		load(): void {}
		unload(): void {}
	}
	return {
		...actual,
		Component: MockComponent,
		MarkdownRenderer: { render: vi.fn() },
		setIcon: vi.fn(),
	};
});

import {
	getPopupWidthForVariant,
	PdfSelectionPopup,
} from "../src/ui/pdf-selection-popup";
import { MarkdownRenderer } from "obsidian";

if (!("addClass" in HTMLElement.prototype)) {
	Object.defineProperty(HTMLElement.prototype, "addClass", {
		value: function addClass(...classes: string[]) {
			this.classList.add(...classes);
		},
	});
}

if (!("createDiv" in HTMLElement.prototype)) {
	Object.defineProperty(HTMLElement.prototype, "createDiv", {
		value: function createDiv(options?: { cls?: string; text?: string }) {
			const el = document.createElement("div");
			if (options?.cls) el.className = options.cls;
			if (options?.text) el.textContent = options.text;
			this.appendChild(el);
			return el;
		},
	});
}

if (!("createSpan" in HTMLElement.prototype)) {
	Object.defineProperty(HTMLElement.prototype, "createSpan", {
		value: function createSpan(options?: { cls?: string; text?: string }) {
			const el = document.createElement("span");
			if (options?.cls) el.className = options.cls;
			if (options?.text) el.textContent = options.text;
			this.appendChild(el);
			return el;
		},
	});
}

if (!("empty" in HTMLElement.prototype)) {
	Object.defineProperty(HTMLElement.prototype, "empty", {
		value: function empty() {
			this.replaceChildren();
		},
	});
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.mocked(MarkdownRenderer.render).mockReset();
	vi.mocked(MarkdownRenderer.render).mockImplementation(async (_app, markdown, container) => {
		container.textContent = String(markdown);
	});
	document.body.innerHTML = '<div class="workspace-leaf-content"><div class="pdfViewer"></div></div>';
});

afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = "";
});

describe("pdf selection popup variants", () => {
	it("gives elaborate mode a wider max width than translate", () => {
		expect(getPopupWidthForVariant("compact", 16)).toBe(320);
		expect(getPopupWidthForVariant("wide", 16)).toBe(640);
	});

	it("shows a character spinner while waiting for streamed text", async () => {
		const popup = new PdfSelectionPopup(
			{} as never,
			new DOMRect(40, 24, 120, 18)
		);

		popup.create("思考中...");
		popup.resetForStreaming();

		const spinner = document.querySelector(".paper-analyzer-explanation-spinner");
		expect(spinner).not.toBeNull();
		expect(document.querySelector(".paper-analyzer-explanation-status")?.textContent).toBe("思考中...");
		expect(spinner?.textContent).toBe("⠋");

		vi.advanceTimersByTime(80);
		expect(document.querySelector(".paper-analyzer-explanation-spinner")?.textContent).toBe("⠙");

		popup.updateText("token");
		await Promise.resolve();
		expect(document.querySelector(".paper-analyzer-explanation-spinner")).toBeNull();
		expect(document.querySelector(".paper-analyzer-explanation-content")?.textContent).toContain("token");

		popup.destroy();
	});

	it("renders markdown while streaming instead of waiting for finalize", async () => {
		const popup = new PdfSelectionPopup(
			{} as never,
			new DOMRect(40, 24, 120, 18)
		);

		popup.create("思考中...");
		popup.resetForStreaming();
		popup.updateText("## Heading");
		await Promise.resolve();

		expect(MarkdownRenderer.render).toHaveBeenCalled();
		expect(document.querySelector(".paper-analyzer-explanation-content")?.textContent).toContain("## Heading");

		popup.destroy();
	});

	it("places the copy button inside a dedicated action area", () => {
		const popup = new PdfSelectionPopup(
			{} as never,
			new DOMRect(40, 24, 120, 18)
		);

		popup.create("思考中...");

		const actionArea = document.querySelector(".paper-analyzer-explanation-actions");
		const copyButton = document.querySelector(".paper-analyzer-explanation-copy");

		expect(actionArea).not.toBeNull();
		expect(actionArea?.contains(copyButton)).toBe(true);

		popup.destroy();
	});
});
