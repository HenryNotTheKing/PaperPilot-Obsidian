import { setIcon } from "obsidian";

const POPUP_CLASS = "paper-analyzer-explanation-popup";
const CONTENT_CLASS = "paper-analyzer-explanation-content";
const COPY_BTN_CLASS = "paper-analyzer-explanation-copy";
const CURSOR_CLASS = "paper-analyzer-explanation-cursor";
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const MAX_HEIGHT = 300;
const MARGIN = 8;

export class PdfSelectionPopup {
	private el: HTMLElement | null = null;
	public contentEl: HTMLElement | null = null;
	private copyBtn: HTMLElement | null = null;
	public cursorEl: HTMLElement | null = null;
	private fullText = "";
	private scrollContainer: HTMLElement | null = null;
	private onScrollHandler: (() => void) | null = null;
	private selectionRect: DOMRect;
	private isFinalized = false;

	constructor(selectionRect: DOMRect) {
		this.selectionRect = selectionRect;
	}

	create(initialText = ""): void {
		this.destroy();

		// Find the PDF viewer container to attach the popup
		const pdfViewer = document.querySelector<HTMLElement>(".pdfViewer");
		if (!pdfViewer) return;
		this.scrollContainer = pdfViewer.closest<HTMLElement>(".workspace-leaf-content") ?? pdfViewer;

		this.el = document.createElement("div");
		this.el.addClass(POPUP_CLASS);
		this.el.style.position = "fixed";
		this.el.style.zIndex = "100";
		this.el.style.minWidth = `${MIN_WIDTH}px`;
		this.el.style.maxWidth = `${MAX_WIDTH}px`;
		this.el.style.maxHeight = `${MAX_HEIGHT}px`;
		this.el.style.overflowY = "auto";
		this.el.style.opacity = "0";
		this.el.style.transition = "opacity 150ms ease";

		this.contentEl = this.el.createDiv({ cls: CONTENT_CLASS });
		this.contentEl.style.whiteSpace = "pre-wrap";
		this.contentEl.style.wordBreak = "break-word";

		this.cursorEl = this.contentEl.createSpan({ cls: CURSOR_CLASS });

		this.copyBtn = this.el.createDiv({ cls: COPY_BTN_CLASS });
		setIcon(this.copyBtn, "copy");
		this.copyBtn.setAttribute("aria-label", "Copy");
		this.copyBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.copyToClipboard();
		});

		document.body.appendChild(this.el);

		this.position(this.selectionRect);
		this.updateText(initialText);

		// Fade in
		requestAnimationFrame(() => {
			if (this.el) this.el.style.opacity = "1";
		});

		// Listen to scroll on the PDF container to reposition
		this.onScrollHandler = () => this.reposition();
		this.scrollContainer.addEventListener("scroll", this.onScrollHandler, { passive: true });
	}

	updateText(token: string): void {
		if (!this.contentEl || !this.cursorEl) return;
		this.fullText += token;

		// Insert text before cursor
		const textNode = document.createTextNode(token);
		this.contentEl.insertBefore(textNode, this.cursorEl);
	}

	setError(message: string): void {
		if (!this.contentEl) return;
		this.contentEl.empty();
		this.contentEl.createSpan({
			text: message,
			cls: "paper-analyzer-explanation-error",
		});
		this.isFinalized = true;
	}

	resetForStreaming(): void {
		if (this.contentEl) {
			this.contentEl.empty();
			this.cursorEl = this.contentEl.createSpan({ cls: CURSOR_CLASS });
		}
		this.fullText = "";
	}

	finalize(): void {
		if (this.cursorEl) {
			this.cursorEl.remove();
			this.cursorEl = null;
		}
		this.isFinalized = true;
	}

	destroy(): void {
		if (this.onScrollHandler && this.scrollContainer) {
			this.scrollContainer.removeEventListener("scroll", this.onScrollHandler);
			this.onScrollHandler = null;
		}
		if (this.el) {
			this.el.style.opacity = "0";
			window.setTimeout(() => {
				this.el?.remove();
				this.el = null;
			}, 150);
		}
		this.contentEl = null;
		this.copyBtn = null;
		this.cursorEl = null;
		this.fullText = "";
	}

	private position(rect: DOMRect): void {
		if (!this.el) return;
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const cardWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rect.width + 40));
		const estimatedHeight = 120; // Initial estimate, will grow naturally

		// Prefer below selection
		let top = rect.bottom + MARGIN;
		if (top + estimatedHeight > viewportHeight - MARGIN) {
			// Not enough space below, place above
			top = rect.top - estimatedHeight - MARGIN;
			if (top < MARGIN) {
				top = MARGIN;
			}
		}

		// Center horizontally on selection
		let left = rect.left + rect.width / 2 - cardWidth / 2;
		left = Math.max(MARGIN, Math.min(left, viewportWidth - cardWidth - MARGIN));

		this.el.style.top = `${top}px`;
		this.el.style.left = `${left}px`;
		this.el.style.width = `${cardWidth}px`;
	}

	private reposition(): void {
		// Re-measure selection rect if still available
		const selection = window.getSelection();
		if (selection && selection.rangeCount > 0) {
			const rect = selection.getRangeAt(0).getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) {
				this.position(rect);
				return;
			}
		}
		// Selection gone — the service layer will call destroy()
	}

	private async copyToClipboard(): Promise<void> {
		if (!this.fullText) return;
		try {
			await navigator.clipboard.writeText(this.fullText);
			if (this.copyBtn) {
				const originalLabel = this.copyBtn.getAttribute("aria-label");
				this.copyBtn.setAttribute("aria-label", "Copied!");
				window.setTimeout(() => {
					if (this.copyBtn && originalLabel) {
						this.copyBtn.setAttribute("aria-label", originalLabel);
					}
				}, 1500);
			}
		} catch {
			// Silently ignore copy failure
		}
	}
}
