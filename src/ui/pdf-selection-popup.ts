import { App, Component, MarkdownRenderer, setIcon } from "obsidian";

const POPUP_CLASS = "paper-analyzer-explanation-popup";
const CONTENT_CLASS = "paper-analyzer-explanation-content";
const ACTIONS_CLASS = "paper-analyzer-explanation-actions";
const COPY_BTN_CLASS = "paper-analyzer-explanation-copy";
const LOADING_CLASS = "paper-analyzer-explanation-loading";
const STATUS_CLASS = "paper-analyzer-explanation-status";
const SPINNER_CLASS = "paper-analyzer-explanation-spinner";
const MARGIN = 8;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠴", "⠦", "⠧", "⠇"];
const DEFAULT_POPUP_FONT_SIZE_PX = 16;

const POPUP_CHARACTER_WIDTHS = {
	compact: 20,
	wide: 40,
} as const;

export type PdfSelectionPopupVariant = keyof typeof POPUP_CHARACTER_WIDTHS;

export function getPopupWidthForVariant(
	variant: PdfSelectionPopupVariant,
	fontSizePx: number
): number {
	const resolvedFontSize =
		Number.isFinite(fontSizePx) && fontSizePx > 0
			? fontSizePx
			: DEFAULT_POPUP_FONT_SIZE_PX;
	return Math.round(POPUP_CHARACTER_WIDTHS[variant] * resolvedFontSize);
}

interface PdfSelectionPopupOptions {
	variant?: PdfSelectionPopupVariant;
}

export class PdfSelectionPopup {
	private app: App;
	private el: HTMLElement | null = null;
	public contentEl: HTMLElement | null = null;
	private actionsEl: HTMLElement | null = null;
	private copyBtn: HTMLElement | null = null;
	private loadingEl: HTMLElement | null = null;
	private loadingText = "思考中...";
	private spinnerEl: HTMLElement | null = null;
	private spinnerTimer: number | null = null;
	private fullText = "";
	private scrollContainer: HTMLElement | null = null;
	private onScrollHandler: (() => void) | null = null;
	private selectionRect: DOMRect;
	private isFinalized = false;
	private component: Component;
	private variant: PdfSelectionPopupVariant;
	private renderQueued = false;
	private renderInFlight = false;
	private renderSessionId = 0;

	constructor(app: App, selectionRect: DOMRect, options?: PdfSelectionPopupOptions) {
		this.app = app;
		this.selectionRect = selectionRect;
		this.component = new Component();
		this.component.load();
		this.variant = options?.variant ?? "compact";
	}

	create(initialText = ""): void {
		this.destroy();
		this.loadingText = initialText.trim() || "思考中...";

		// Find the PDF viewer container to attach the popup
		const pdfViewer = document.querySelector<HTMLElement>(".pdfViewer");
		if (!pdfViewer) return;
		this.scrollContainer = pdfViewer.closest<HTMLElement>(".workspace-leaf-content") ?? pdfViewer;

		this.el = document.createElement("div");
		this.el.addClass(POPUP_CLASS);

		this.contentEl = this.el.createDiv({ cls: CONTENT_CLASS });
		this.startSpinner();
		this.actionsEl = this.el.createDiv({ cls: ACTIONS_CLASS });

		this.copyBtn = this.actionsEl.createDiv({ cls: COPY_BTN_CLASS });
		setIcon(this.copyBtn, "copy");
		this.copyBtn.setAttribute("aria-label", "Copy");
		this.copyBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			void this.copyToClipboard();
		});

		document.body.appendChild(this.el);

		this.position(this.selectionRect);
		// Fade in
		requestAnimationFrame(() => {
			if (this.el) {
				// eslint-disable-next-line obsidianmd/no-static-styles-assignment
				this.el.style.opacity = "1";
			}
		});

		// Listen to scroll on the PDF container to reposition
		this.onScrollHandler = () => this.reposition();
		this.scrollContainer.addEventListener("scroll", this.onScrollHandler, { passive: true });
	}

	updateText(token: string): void {
		if (!this.contentEl) return;
		this.stopSpinner();
		this.fullText += token;
		this.queueMarkdownRender();
	}

	setError(message: string): void {
		if (!this.contentEl) return;
		this.renderSessionId += 1;
		this.renderQueued = false;
		this.stopSpinner();
		this.contentEl.empty();
		this.contentEl.createSpan({
			text: message,
			cls: "paper-analyzer-explanation-error",
		});
		this.isFinalized = true;
	}

	resetForStreaming(): void {
		this.renderSessionId += 1;
		this.renderQueued = false;
		if (this.contentEl) {
			this.contentEl.empty();
			this.startSpinner();
		}
		this.fullText = "";
	}

	finalize(): void {
		this.stopSpinner();
		this.isFinalized = true;
		if (this.fullText) {
			this.queueMarkdownRender();
		}
	}

	destroy(): void {
		this.renderSessionId += 1;
		this.renderQueued = false;
		if (this.onScrollHandler && this.scrollContainer) {
			this.scrollContainer.removeEventListener("scroll", this.onScrollHandler);
			this.onScrollHandler = null;
		}
		if (this.el) {
			// eslint-disable-next-line obsidianmd/no-static-styles-assignment
			this.el.style.opacity = "0";
			window.setTimeout(() => {
				this.el?.remove();
				this.el = null;
			}, 150);
		}
		this.contentEl = null;
		this.actionsEl = null;
		this.copyBtn = null;
		this.stopSpinner();
		this.fullText = "";
		this.component.unload();
	}

	private queueMarkdownRender(): void {
		if (!this.contentEl) return;
		this.renderQueued = true;
		if (this.renderInFlight) return;
		void this.flushMarkdownRenderQueue();
	}

	private async flushMarkdownRenderQueue(): Promise<void> {
		if (!this.contentEl) return;
		this.renderInFlight = true;

		while (this.renderQueued && this.contentEl) {
			this.renderQueued = false;
			const sessionId = this.renderSessionId;
			const markdown = this.fullText;
			const rendered = document.createElement("div");
			await MarkdownRenderer.render(
				this.app,
				markdown,
				rendered,
				"",
				this.component
			);

			if (!this.contentEl || sessionId !== this.renderSessionId) {
				continue;
			}

			this.contentEl.empty();
			while (rendered.firstChild) {
				this.contentEl.appendChild(rendered.firstChild);
			}
		}

		this.renderInFlight = false;
	}

	private startSpinner(): void {
		if (!this.contentEl) return;
		this.stopSpinner();
		let frameIndex = 0;
		this.loadingEl = this.contentEl.createDiv({ cls: LOADING_CLASS });
		this.loadingEl.createDiv({
			cls: STATUS_CLASS,
			text: this.loadingText,
		});
		this.spinnerEl = this.loadingEl.createDiv({
			cls: SPINNER_CLASS,
			text: SPINNER_FRAMES[frameIndex] ?? "⠋",
		});
		this.spinnerTimer = window.setInterval(() => {
			frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
			if (this.spinnerEl) {
				const nextFrame = SPINNER_FRAMES[frameIndex] ?? "⠋";
				this.spinnerEl.textContent = nextFrame;
			}
		}, 80);
	}

	private stopSpinner(): void {
		if (this.spinnerTimer !== null) {
			window.clearInterval(this.spinnerTimer);
			this.spinnerTimer = null;
		}
		if (this.spinnerEl) {
			this.spinnerEl.remove();
			this.spinnerEl = null;
		}
		if (this.loadingEl) {
			this.loadingEl.remove();
			this.loadingEl = null;
		}
	}

	private position(rect: DOMRect): void {
		if (!this.el) return;
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const fontSizePx = Number.parseFloat(window.getComputedStyle(this.el).fontSize);
		const maxCardWidth = Math.max(0, viewportWidth - MARGIN * 2);
		const cardWidth = Math.min(
			getPopupWidthForVariant(this.variant, fontSizePx),
			maxCardWidth
		);
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
