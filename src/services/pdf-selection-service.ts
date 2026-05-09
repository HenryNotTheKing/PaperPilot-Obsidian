import type { App, TFile } from "obsidian";
import { FileView } from "obsidian";
import { PdfSelectionPopup } from "../ui/pdf-selection-popup";
import { callLlmStream } from "./pdf-explanation-client";
import { parsePdf } from "./pdf-parser";
import type { PaperAnalyzerSettings } from "../settings";
import type { LlmConfig } from "../types";

const WORD_MAX_LENGTH = 30;
const SYSTEM_PROMPT = `你是一位学术助手，正在帮助用户阅读英文学术论文。请根据提供的论文上下文，用中文简洁准确地回答。只输出解释内容，不要添加任何问候语或格式标记。`;

function isSelectionInPdfViewer(selection: Selection): boolean {
	if (!selection.rangeCount) return false;
	const container = selection.getRangeAt(0).commonAncestorContainer;
	const element = container instanceof Element ? container : container.parentElement;
	return !!element?.closest(".pdfViewer");
}

function getPdfFileFromSelection(app: App, selection: Selection): TFile | null {
	if (!selection.rangeCount) return null;
	const container = selection.getRangeAt(0).commonAncestorContainer;
	const element = container instanceof Element ? container : container.parentElement;
	const pageEl = element?.closest<HTMLElement>(".page");
	if (!pageEl) {
		console.debug("[PDF解释] 未找到 .page 元素");
		return null;
	}

	const pdfViewer = pageEl.closest<HTMLElement>(".pdfViewer");
	if (!pdfViewer) {
		console.debug("[PDF解释] 未找到 .pdfViewer 元素");
		return null;
	}

	let foundFile: TFile | null = null;
	app.workspace.iterateAllLeaves((leaf) => {
		if (foundFile) return;
		const view = leaf.view;
		if (view instanceof FileView && view.file?.extension === "pdf") {
			// Check if this PDF view contains the selected pdfViewer
			if (view.containerEl.contains(pdfViewer)) {
				foundFile = view.file;
			}
		}
	});
	if (!foundFile) {
		console.debug("[PDF解释] 未找到匹配的 PDF 文件");
	}
	return foundFile;
}

function detectSelectionType(text: string): "word" | "paragraph" {
	const trimmed = text.trim();
	if (trimmed.length <= WORD_MAX_LENGTH && !/\s/.test(trimmed)) {
		return "word";
	}
	return "paragraph";
}

async function getContextFromPdf(
	app: App,
	pdfFile: TFile,
	selectedText: string,
	contextWindow: number
): Promise<string> {
	try {
		const pages = await parsePdf(app, pdfFile);
		// Build full text from all pages
		const fullText = pages.map((p) => p.fullText).join("\n\n");

		// Find the selected text in the full document
		const index = fullText.indexOf(selectedText);
		if (index === -1) {
			// Fallback: try with normalized whitespace
			const normalizedDoc = fullText.replace(/\s+/g, " ");
			const normalizedSelection = selectedText.replace(/\s+/g, " ");
			const normIndex = normalizedDoc.indexOf(normalizedSelection);
			if (normIndex === -1) return "";
			const start = Math.max(0, normIndex - contextWindow);
			const end = Math.min(normalizedDoc.length, normIndex + normalizedSelection.length + contextWindow);
			return normalizedDoc.slice(start, end);
		}

		const start = Math.max(0, index - contextWindow);
		const end = Math.min(fullText.length, index + selectedText.length + contextWindow);
		return fullText.slice(start, end);
	} catch {
		return "";
	}
}

function buildUserPrompt(type: "word" | "paragraph", text: string, context: string): string {
	if (type === "word") {
		return `请根据以下论文上下文，翻译并简要解释这个术语：\n\n术语：${text}\n\n上下文：${context}`;
	}
	return `请根据以下论文上下文，解释这段文字的含义：\n\n段落：${text}\n\n上下文：${context}`;
}

export class PdfSelectionService {
	private app: App;
	private getSettings: () => PaperAnalyzerSettings;
	private popup: PdfSelectionPopup | null = null;
	private abortController: AbortController | null = null;
	private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
	private selectionHandler: (() => void) | null = null;

	constructor(app: App, getSettings: () => PaperAnalyzerSettings) {
		this.app = app;
		this.getSettings = getSettings;
	}

	attach(): void {
		this.keydownHandler = (e: KeyboardEvent) => {
			if (e.shiftKey && e.key.toLowerCase() === "t") {
				console.debug("[PDF解释] Shift+T 触发");
				e.preventDefault();
				void this.handleExplainRequest();
			}
		};
		document.addEventListener("keydown", this.keydownHandler);
		console.debug("[PDF解释] PdfSelectionService 已 attach");

		// Auto-hide popup when selection is cleared
		this.selectionHandler = () => {
			const selection = window.getSelection();
			if (!selection || selection.toString().trim().length === 0) {
				this.destroyPopup();
			}
		};
		document.addEventListener("selectionchange", this.selectionHandler);
	}

	detach(): void {
		if (this.keydownHandler) {
			document.removeEventListener("keydown", this.keydownHandler);
			this.keydownHandler = null;
		}
		if (this.selectionHandler) {
			document.removeEventListener("selectionchange", this.selectionHandler);
			this.selectionHandler = null;
		}
		this.destroyPopup();
	}

	async handleExplainRequest(): Promise<void> {
		console.debug("[PDF解释] handleExplainRequest 开始");
		const selection = window.getSelection();
		if (!selection || selection.toString().trim().length === 0) {
			console.debug("[PDF解释] 无选区，退出");
			return;
		}
		if (!isSelectionInPdfViewer(selection)) {
			console.debug("[PDF解释] 选区不在 PDF viewer 中");
			return;
		}

		const selectedText = selection.toString().trim();
		console.debug("[PDF解释] 选中文本:", selectedText.slice(0, 50));
		const pdfFile = getPdfFileFromSelection(this.app, selection);
		if (!pdfFile) {
			console.debug("[PDF解释] 无法解析 PDF 文件");
			return;
		}
		console.debug("[PDF解释] PDF 文件:", pdfFile.path);

		const rect = selection.getRangeAt(0).getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) {
			console.debug("[PDF解释] 选区 rect 无效");
			return;
		}

		// Abort any ongoing request and clean up old popup
		this.abortController?.abort();
		this.destroyPopup();

		this.popup = new PdfSelectionPopup(this.app, rect);
		this.popup.create("思考中...");

		this.abortController = new AbortController();

		const settings = this.getSettings();
		const type = detectSelectionType(selectedText);

		// Get context
		const context = await getContextFromPdf(
			this.app,
			pdfFile,
			selectedText,
			settings.explanationContextWindow
		);

		const userPrompt = buildUserPrompt(type, selectedText, context);

		const llmConfig: LlmConfig = {
			baseUrl: settings.extractionBaseUrl,
			apiKey: settings.extractionApiKey,
			model: settings.extractionModel,
			provider: settings.extractionProvider,
		};

		// Reset content for streaming
		this.popup.resetForStreaming();

		await callLlmStream(
			llmConfig,
			SYSTEM_PROMPT,
			userPrompt,
			{
				onToken: (token) => {
					this.popup?.updateText(token);
				},
				onDone: () => {
					this.popup?.finalize();
				},
				onError: (error) => {
					this.popup?.setError(error.message);
					window.setTimeout(() => this.destroyPopup(), 3000);
				},
			},
			this.abortController.signal
		);
	}

	private destroyPopup(): void {
		this.abortController?.abort();
		this.abortController = null;
		this.popup?.destroy();
		this.popup = null;
	}
}
