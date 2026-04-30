import { findBestMatch } from "../services/fuzzy-matcher";
import type { PageTextItem } from "../services/pdf-parser";
import { DEFAULT_TYPE_COLOR_MAP, toHighlightFillColor } from "../types";
import type { StoredHighlight } from "../types";

const HL_LAYER_CLS = "paper-analyzer-hl-layer";

interface PageDomItem {
	item: PageTextItem;
	span: HTMLElement;
	textNode: Text | null;
}

interface MeasuredSlice {
	rect: DOMRect;
	text: string;
}

interface RowSlice {
	left: number;
	right: number;
	top: number;
	bottom: number;
	height: number;
	text: string;
}

/**
 * Renders highlight overlays on the Obsidian built-in PDF viewer.
 *
 * Uses Range API for character-level precision on first/last spans.
 * Handles zoom via MutationObserver on .pdfViewer style (--scale-factor),
 * and virtual scroll via data-loaded attribute changes.
 * Double-requestAnimationFrame delay ensures layout is complete before measuring.
 */
export class PdfHighlightLayer {
	readonly containerEl: HTMLElement;
	private readonly highlights: StoredHighlight[];
	private readonly typeColorMap: Record<string, string>;
	private readonly highlightOpacity: number;
	private pageObs: MutationObserver | null = null;
	private styleObs: MutationObserver | null = null;
	private renderTimer: number | null = null;

	constructor(
		containerEl: HTMLElement,
		highlights: StoredHighlight[],
		typeColorMap: Record<string, string>,
		highlightOpacity: number
	) {
		this.containerEl = containerEl;
		this.highlights = highlights;
		this.typeColorMap = typeColorMap;
		this.highlightOpacity = highlightOpacity;
	}

	attach(): void {
		const pdfViewer = this.containerEl.querySelector<HTMLElement>(".pdfViewer");
		if (!pdfViewer) return;
		if (pdfViewer.dataset["paAttached"]) return;
		pdfViewer.dataset["paAttached"] = "1";

		// Initial render
		this.scheduleRender();

		// Virtual scroll: page data-loaded changes
		this.pageObs = new MutationObserver((mutations) => {
			let needsRender = false;
			for (const mut of mutations) {
				if (
					mut.type === "attributes" &&
					mut.attributeName === "data-loaded"
				) {
					const el = mut.target as HTMLElement;
					if (el.classList.contains("page")) {
						if (el.getAttribute("data-loaded") !== "true") {
							el.querySelector(`.${HL_LAYER_CLS}`)?.remove();
						} else {
							needsRender = true;
						}
					}
				}
			}
			if (needsRender) this.scheduleRender();
		});
		this.pageObs.observe(pdfViewer, {
			subtree: true,
			childList: false,
			attributes: true,
			attributeFilter: ["data-loaded"],
		});

		// Zoom: --scale-factor changes reflected in pdfViewer style attribute
		this.styleObs = new MutationObserver(() => {
			this.scheduleRender();
		});
		this.styleObs.observe(pdfViewer, {
			attributes: true,
			attributeFilter: ["style"],
		});
	}

	destroy(): void {
		if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
		this.pageObs?.disconnect();
		this.pageObs = null;
		this.styleObs?.disconnect();
		this.styleObs = null;

		const pdfViewer = this.containerEl.querySelector<HTMLElement>(".pdfViewer");
		if (pdfViewer) delete pdfViewer.dataset["paAttached"];

		this.containerEl
			.querySelectorAll(`.${HL_LAYER_CLS}`)
			.forEach((el) => el.remove());
	}

	// ── scheduling ──────────────────────────────────────────────────────────

	/**
	 * Debounce + double-rAF to ensure the textLayer is fully laid out
	 * before we measure positions.
	 */
	private scheduleRender(): void {
		if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
		this.renderTimer = window.setTimeout(() => {
			this.renderTimer = null;
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					this.renderAllPages();
				});
			});
		}, 120);
	}

	private renderAllPages(): void {
		const pdfViewer = this.containerEl.querySelector<HTMLElement>(".pdfViewer");
		if (!pdfViewer) return;
		const pages = Array.from(
			pdfViewer.querySelectorAll<HTMLElement>('.page[data-loaded="true"]')
		);
		for (const page of pages) this.renderPage(page);
	}

	// ── per-page rendering ──────────────────────────────────────────────────

	private renderPage(pageEl: HTMLElement): void {
		const pageNum = parseInt(pageEl.getAttribute("data-page-number") ?? "0");
		const pageHighlights = this.highlights.filter((h) => h.pageNum === pageNum);
		if (pageHighlights.length === 0) return;

		const textLayer = pageEl.querySelector<HTMLElement>(".textLayer");
		if (!textLayer) return;

		// Remove old overlay and rebuild
		pageEl.querySelector(`.${HL_LAYER_CLS}`)?.remove();

		const textLayerRect = textLayer.getBoundingClientRect();
		if (textLayerRect.width === 0 || textLayerRect.height === 0) return;

		const hlLayer = textLayer.createDiv({ cls: HL_LAYER_CLS });
		const pageDomItems = this.buildPageDomItems(textLayer, pageNum);
		const spansByLegacyIdx = new Map<number, PageDomItem>();
		for (const domItem of pageDomItems) {
			const idx = parseInt(domItem.span.getAttribute("data-idx") ?? "-1");
			if (idx >= 0) spansByLegacyIdx.set(idx, domItem);
		}

		for (const hl of pageHighlights) {
			const rects = this.measureHighlight(hl, pageDomItems, spansByLegacyIdx);
			for (const pctRect of this.toPctRows(rects, textLayerRect)) {
				const div = hlLayer.createDiv({
					cls: `paper-analyzer-hl paper-analyzer-hl--${hl.type}`,
				});
				div.style.left = `${pctRect.left}%`;
				div.style.top = `${pctRect.top}%`;
				div.style.width = `${pctRect.width}%`;
				div.style.height = `${pctRect.height}%`;
				div.style.backgroundColor = this.getHighlightFill(hl.type);
			}
		}
	}

	private getHighlightFill(type: string): string {
		const baseColor = this.typeColorMap[type] ?? DEFAULT_TYPE_COLOR_MAP[type] ?? "#ffd000";
		return toHighlightFillColor(baseColor, this.highlightOpacity);
	}

	// ── measuring ───────────────────────────────────────────────────────────

	/**
	 * Collect DOMRects for the highlighted text.
	 * Re-matches exact_text against the rendered textLayer because pdf.js parser
	 * items do not align 1:1 with the viewer spans. Falls back to legacy indices
	 * only when a DOM match cannot be recovered.
	 */
	private measureHighlight(
		hl: StoredHighlight,
		pageDomItems: PageDomItem[],
		spansByLegacyIdx: Map<number, PageDomItem>
	): MeasuredSlice[] {
		const domMatch = this.findDomMatch(hl, pageDomItems);
		if (domMatch) {
			return this.measureMatchedItems(
				domMatch.beginIndex,
				domMatch.beginOffset,
				domMatch.endIndex,
				domMatch.endOffset,
				pageDomItems
			);
		}

		return this.measureLegacyHighlight(hl, spansByLegacyIdx);
	}

	private findDomMatch(
		hl: StoredHighlight,
		pageDomItems: PageDomItem[]
	) {
		if (!hl.exact_text.trim() || pageDomItems.length === 0) return null;
		return findBestMatch(
			hl.exact_text,
			pageDomItems.map(({ item }) => item),
			0.55
		);
	}

	private measureMatchedItems(
		beginIndex: number,
		beginOffset: number,
		endIndex: number,
		endOffset: number,
		pageDomItems: PageDomItem[]
	): MeasuredSlice[] {
		if (beginIndex > endIndex) return [];

		const allRects: MeasuredSlice[] = [];
		for (let idx = beginIndex; idx <= endIndex; idx++) {
			const domItem = pageDomItems[idx];
			if (!domItem) continue;

			const baseRect = domItem.span.getBoundingClientRect();
			if (baseRect.width <= 0 || baseRect.height <= 0) continue;

			const text = domItem.item.text;
			const textLen = text.length;
			if (textLen === 0) continue;

			const startOff = idx === beginIndex
				? Math.min(Math.max(beginOffset, 0), textLen)
				: 0;
			const finalEndOff = idx === endIndex
				? Math.min(Math.max(endOffset, 0), textLen)
				: textLen;

			if (startOff >= finalEndOff) continue;

			const sliceText = text.slice(startOff, finalEndOff);
			const rect = domItem.textNode
				? this.measureSpanSliceRect(
					domItem.textNode,
					startOff,
					finalEndOff,
					textLen,
					baseRect
				)
				: baseRect;

			if (!rect) continue;
			allRects.push({ rect, text: sliceText });
		}

		return allRects;
	}

	private measureLegacyHighlight(
		hl: StoredHighlight,
		spansByLegacyIdx: Map<number, PageDomItem>
	): MeasuredSlice[] {
		const idxRange: number[] = [];
		for (const idx of spansByLegacyIdx.keys()) {
			if (idx >= hl.beginIndex && idx <= hl.endIndex) {
				idxRange.push(idx);
			}
		}
		idxRange.sort((a, b) => a - b);

		const allRects: MeasuredSlice[] = [];

		for (const idx of idxRange) {
			const domItem = spansByLegacyIdx.get(idx);
			if (!domItem) continue;

			const baseRect = domItem.span.getBoundingClientRect();
			if (baseRect.width <= 0 || baseRect.height <= 0) continue;

			const textNode = domItem.textNode;
			if (!textNode) {
				allRects.push({ rect: baseRect, text: domItem.item.text });
				continue;
			}
			const textLen = textNode.textContent?.length ?? 0;
			if (textLen === 0) continue;

			const isFirst = idx === hl.beginIndex;
			const isLast = idx === hl.endIndex;

			const startOff = isFirst
				? Math.min(Math.max(hl.beginOffset, 0), textLen)
				: 0;
			const endOff = isLast
				? Math.min(Math.max(hl.endOffset, 0), textLen)
				: textLen;

			if (startOff >= endOff) continue;

			const rect = this.measureSpanSliceRect(
				textNode,
				startOff,
				endOff,
				textLen,
				baseRect
			);
			allRects.push({
				rect: rect ?? baseRect,
				text: textNode.textContent?.slice(startOff, endOff) ?? "",
			});
		}

		return allRects;
	}

	private buildPageDomItems(
		textLayer: HTMLElement,
		pageNum: number
	): PageDomItem[] {
		const domItems: PageDomItem[] = [];
		let index = 0;

		for (const span of Array.from(
			textLayer.querySelectorAll<HTMLElement>("span.textLayerNode")
		)) {
			const textNode = this.getTextNode(span);
			const text = textNode?.textContent ?? span.textContent ?? "";
			if (text.length === 0) continue;

			const rect = span.getBoundingClientRect();
			domItems.push({
				item: {
					text,
					height: rect.height,
					pageNum,
					index,
					x: rect.left,
					y: rect.top,
					width: rect.width,
					fontName: "",
				},
				span,
				textNode,
			});
			index++;
		}

		return domItems;
	}

	private measureSpanSliceRect(
		textNode: Text,
		startOff: number,
		endOff: number,
		textLen: number,
		baseRect: DOMRect
	): DOMRect | null {
		const fallback = this.measureRangeRect(textNode, startOff, endOff);
		if (fallback) {
			const horizontalPad = Math.min(5, Math.max(3, baseRect.height * 0.14));
			const topCrop = Math.min(4.8, Math.max(3.8, fallback.height * 0.10));
			const bottomCrop = Math.min(6.8, Math.max(5.8, fallback.height * 0.145));
			const finalHeight = Math.max(1, fallback.height - topCrop - bottomCrop);
			return new DOMRect(
				fallback.left - horizontalPad,
				fallback.top + topCrop,
				fallback.width + horizontalPad * 2,
				finalHeight
			);
		}

		if (startOff <= 0 && endOff >= textLen) return baseRect;

		const leftBoundary = startOff <= 0
			? baseRect.left
			: (this.measureBoundaryX(textNode, startOff, "start") ?? baseRect.left);
		const rightBoundary = endOff >= textLen
			? baseRect.right
			: (this.measureBoundaryX(textNode, endOff, "end") ?? baseRect.right);
		const pad = Math.min(2, Math.max(1, baseRect.height * 0.08));

		const left = Math.max(baseRect.left, Math.min(leftBoundary, baseRect.right) - pad);
		const right = Math.min(baseRect.right, Math.max(rightBoundary, baseRect.left) + pad);
		if (right <= left) {
			return fallback ?? baseRect;
		}

		return new DOMRect(left, baseRect.top, right - left, baseRect.height);
	}

	private measureRangeRect(
		textNode: Text,
		startOff: number,
		endOff: number
	): DOMRect | null {
		const range = document.createRange();
		range.setStart(textNode, startOff);
		range.setEnd(textNode, endOff);
		const rect = range.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0 ? rect : null;
	}

	private measureBoundaryX(
		textNode: Text,
		offset: number,
		kind: "start" | "end"
	): number | null {
		const textLen = textNode.textContent?.length ?? 0;
		if (textLen === 0) return null;

		if (kind === "start") {
			if (offset <= 0 || offset >= textLen) return null;
			const range = document.createRange();
			range.setStart(textNode, offset);
			range.setEnd(textNode, offset + 1);
			const rect = range.getBoundingClientRect();
			return rect.width > 0 ? rect.left : null;
		}

		if (offset <= 0 || offset > textLen) return null;
		const range = document.createRange();
		range.setStart(textNode, Math.max(0, offset - 1));
		range.setEnd(textNode, offset);
		const rect = range.getBoundingClientRect();
		return rect.width > 0 ? rect.right : null;
	}

	private getTextNode(span: HTMLElement): Text | null {
		for (let i = 0; i < span.childNodes.length; i++) {
			const node = span.childNodes[i];
			if (node?.nodeType === Node.TEXT_NODE) return node as Text;
		}
		return null;
	}

	// ── layout helpers ──────────────────────────────────────────────────────

	/**
	 * Convert client DOMRects to page-relative % rects, merging
	 * rects on the same visual row and collapsing prose spans into one cluster.
	 * Formula-like clusters are dropped to avoid rendering tiny fragmented math
	 * glyph boxes when the stored exact_text includes equation content.
	 */
	private toPctRows(
		clientRects: MeasuredSlice[],
		pageRect: DOMRect
	): Array<{ left: number; top: number; width: number; height: number }> {
		const pctRects: RowSlice[] = [];
		for (const slice of clientRects) {
			const r = slice.rect;
			if (r.width <= 0 || r.height <= 0) continue;
			const left = Math.max(pageRect.left, r.left);
			const right = Math.min(pageRect.right, r.right);
			const top = Math.max(pageRect.top, r.top);
			const bottom = Math.min(pageRect.bottom, r.bottom);
			const height = bottom - top;
			if (right <= left || height <= 0) continue;
			pctRects.push({ left, top, right, bottom, height, text: slice.text });
		}

		if (pctRects.length === 0) return [];

		pctRects.sort((a, b) => {
			const ay = a.top + a.height / 2;
			const by = b.top + b.height / 2;
			const dy = ay - by;
			if (Math.abs(dy) > Math.max(a.height, b.height) * 0.45) return dy;
			return a.left - b.left;
		});

		const rows: RowSlice[][] = [];
		let currentRow: RowSlice[] = [];

		const flushRow = (): void => {
			if (currentRow.length === 0) return;
			rows.push(currentRow);
			currentRow = [];
		};

		for (const rect of pctRects) {
			if (currentRow.length === 0) {
				currentRow.push(rect);
				continue;
			}

			const prev = currentRow[currentRow.length - 1]!;
			const prevCenterY = prev.top + prev.height / 2;
			const nextCenterY = rect.top + rect.height / 2;
			const rowTolerance = Math.max(prev.height, rect.height) * 0.55;

			if (Math.abs(prevCenterY - nextCenterY) <= rowTolerance) {
				currentRow.push(rect);
			} else {
				flushRow();
				currentRow.push(rect);
			}
		}

		flushRow();

		const mergedPx: RowSlice[] = [];
		for (const row of rows) {
			row.sort((a, b) => a.left - b.left);
			const clusters: RowSlice[][] = [];
			let cluster: RowSlice[] = [];

			const flushCluster = (): void => {
				if (cluster.length === 0) return;
				clusters.push(cluster);
				cluster = [];
			};

			for (const rect of row) {
				if (cluster.length === 0) {
					cluster.push(rect);
					continue;
				}

				const prev = cluster[cluster.length - 1]!;
				const gap = rect.left - prev.right;
				const overlap = Math.min(prev.bottom, rect.bottom) - Math.max(prev.top, rect.top);
				const overlapRatio = overlap / Math.max(1, Math.min(prev.height, rect.height));
				const mergeGap = Math.max(
					3,
					Math.min(7, Math.max(prev.height, rect.height) * 0.45)
				);

				if (gap <= mergeGap && overlapRatio >= 0.45) {
					cluster.push(rect);
				} else {
					flushCluster();
					cluster.push(rect);
				}
			}

			flushCluster();

			const mathFlags = clusters.map((item) => this.isMathLikeCluster(item));
			for (let i = 0; i < clusters.length; i++) {
				const item = clusters[i]!;
				if (mathFlags[i]) continue;

				const touchesMath = Boolean(mathFlags[i - 1] || mathFlags[i + 1]);
				if (this.isMathAdjacentShortCluster(item, touchesMath)) continue;

				mergedPx.push(this.mergeCluster(item, pageRect));
			}
		}

		return mergedPx.map((rect) => ({
			left: ((rect.left - pageRect.left) / pageRect.width) * 100,
			top: ((rect.top - pageRect.top) / pageRect.height) * 100,
			width: ((rect.right - rect.left) / pageRect.width) * 100,
			height: ((rect.bottom - rect.top) / pageRect.height) * 100,
		}));
	}

	private mergeCluster(cluster: RowSlice[], pageRect: DOMRect): RowSlice {
		const merged = cluster.reduce<RowSlice>((acc, slice) => ({
			left: Math.min(acc.left, slice.left),
			right: Math.max(acc.right, slice.right),
			top: Math.min(acc.top, slice.top),
			bottom: Math.max(acc.bottom, slice.bottom),
			height: Math.max(acc.bottom, slice.bottom) - Math.min(acc.top, slice.top),
			text: acc.text + slice.text,
		}), { ...cluster[0]!, text: cluster[0]!.text });

		const pad = Math.min(1.25, Math.max(0.5, merged.height * 0.06));
		merged.left = Math.max(pageRect.left, merged.left - pad);
		merged.right = Math.min(pageRect.right, merged.right + pad);
		merged.height = merged.bottom - merged.top;
		return merged;
	}

	private isMathLikeCluster(cluster: RowSlice[]): boolean {
		const text = cluster.map((slice) => slice.text).join("");
		const compact = text.replace(/\s+/g, "");
		if (compact.length === 0) return true;

		// eslint-disable-next-line no-control-regex
		const controlCount = this.countMatches(compact, /[\u0000-\u001f]/g);
		const greekOrMathCount = this.countMatches(compact, /[Λ∆πθβσ∑∫≈≠≤≥±∞∼−×÷]/gu);
		const alphaNumCount = this.countMatches(compact, /[A-Za-z0-9]/g);
		const nonWordCount = compact.length - alphaNumCount;
		const shortSlices = cluster.filter((slice) => slice.text.trim().length > 0 && slice.text.trim().length <= 3).length;

		if (controlCount > 0) return true;
		if (compact.length <= 3 && (greekOrMathCount > 0 || nonWordCount > 0)) return true;
		if (greekOrMathCount >= 2) return true;
		if (cluster.length >= 6 && shortSlices >= Math.ceil(cluster.length * 0.6) && nonWordCount >= Math.max(4, alphaNumCount * 0.5)) {
			return true;
		}
		if (cluster.length >= 4 && nonWordCount >= Math.max(5, alphaNumCount)) {
			return true;
		}

		return false;
	}

	private isMathAdjacentShortCluster(
		cluster: RowSlice[],
		adjacentToMath: boolean
	): boolean {
		if (!adjacentToMath) return false;

		const compact = cluster
			.map((slice) => slice.text)
			.join("")
			.replace(/\s+/g, "");
		if (compact.length === 0 || compact.length > 4 || cluster.length > 2) {
			return false;
		}

		const left = Math.min(...cluster.map((slice) => slice.left));
		const right = Math.max(...cluster.map((slice) => slice.right));
		const top = Math.min(...cluster.map((slice) => slice.top));
		const bottom = Math.max(...cluster.map((slice) => slice.bottom));
		const width = right - left;
		const height = bottom - top;

		return width <= Math.max(16, height * 2.5);
	}

	private countMatches(text: string, regex: RegExp): number {
		const matches = text.match(regex);
		return matches?.length ?? 0;
	}
}
