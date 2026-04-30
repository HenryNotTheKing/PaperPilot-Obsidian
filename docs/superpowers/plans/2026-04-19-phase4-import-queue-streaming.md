# Phase 4: Import Queue & Streaming Match Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Levenshtein fuzzy matcher with BMH, add analysis-runner abstraction, build a persistent background analysis queue, and redesign ImportModal for multi-URL batch import with per-row progress.

**Architecture:** Four independent layers built bottom-up: (1) BMH fuzzy-matcher + updated pdf-anchor, (2) analysis-runner extracted from AnalyzeModal, (3) AnalyzeQueue with persist/resume, (4) redesigned ImportModal + settings queue UI. Each layer is tested before the next begins.

**Tech Stack:** TypeScript, Obsidian Plugin API, Vitest (jsdom), esbuild, eslint-plugin-obsidianmd

---

## Chunk 1: BMH Fuzzy Matcher + Updated pdf-anchor

### Task 1: Replace fuzzy-matcher.ts with BMH algorithm

**Files:**
- Modify: `src/services/fuzzy-matcher.ts` (full rewrite)
- Modify: `tests/fuzzy-matcher.test.ts` (update + add new cases)

**Context:** The current implementation uses Levenshtein sliding-window similarity. We replace it with Boyer-Moore-Horspool (BMH) — a linear-time exact substring search — plus a prefix-fallback path. The external interface (`findBestMatch`) stays identical so nothing else breaks.

**BMH algorithm:** Build a "bad character" skip table from the needle. When a character mismatch occurs during search, skip forward by the precomputed amount rather than sliding one position at a time. Average O(n/m) where m=needle length.

- [ ] **Step 1.1: Update the existing tests to cover the new BMH contract**

Replace the contents of `tests/fuzzy-matcher.test.ts` with:

```typescript
import { describe, expect, it } from "vitest";
import { findBestMatch } from "../src/services/fuzzy-matcher";
import type { PageTextItem } from "../src/services/pdf-parser";

function makeItems(texts: string[]): PageTextItem[] {
	return texts.map((text, i) => ({ text, height: 10, pageNum: 1, index: i }));
}

describe("findBestMatch — BMH", () => {
	it("returns null for empty needle", () => {
		expect(findBestMatch("", makeItems(["hello"]))).toBeNull();
		expect(findBestMatch("   ", makeItems(["hello"]))).toBeNull();
	});

	it("returns null for empty items array", () => {
		expect(findBestMatch("hello", [])).toBeNull();
	});

	it("exact match within a single item → score 1.0", () => {
		const items = makeItems(["foo bar", "hello world", "baz qux"]);
		const m = findBestMatch("hello world", items);
		expect(m).not.toBeNull();
		expect(m!.score).toBe(1.0);
		expect(m!.beginIndex).toBe(1);
		expect(m!.endIndex).toBe(1);
	});

	it("exact match spanning two items → score 1.0", () => {
		const items = makeItems(["The quick", "brown fox"]);
		// flat text = "The quick brown fox " — needle found verbatim
		const m = findBestMatch("The quick brown fox", items);
		expect(m).not.toBeNull();
		expect(m!.score).toBe(1.0);
		expect(m!.beginIndex).toBe(0);
		expect(m!.endIndex).toBe(1);
	});

	it("case-insensitive normalized exact match → score 1.0", () => {
		const items = makeItems(["THE QUICK", "BROWN FOX"]);
		const m = findBestMatch("the quick brown fox", items);
		expect(m).not.toBeNull();
		expect(m!.score).toBe(1.0);
	});

	it("prefix fallback (60% of needle) → score 0.85", () => {
		// needle has 20 chars, first 12 chars exist in items, last 8 do not
		const items = makeItems(["hello world foo", "bar baz"]);
		const needle = "hello world foo XXXXXXXX"; // last 8 chars not in items
		const m = findBestMatch(needle, items);
		expect(m).not.toBeNull();
		expect(m!.score).toBe(0.85);
	});

	it("prefix fallback below threshold → null", () => {
		const items = makeItems(["hello world foo", "bar baz"]);
		const needle = "hello world foo XXXXXXXX";
		// threshold of 0.9 rejects 0.85
		const m = findBestMatch(needle, items, 0.9);
		expect(m).toBeNull();
	});

	it("no match → null", () => {
		const items = makeItems(["apple banana", "cherry date"]);
		expect(findBestMatch("xyz 12345 completely unrelated", items)).toBeNull();
	});

	it("beginOffset is 0 when needle starts at item boundary", () => {
		const items = makeItems(["alpha", "beta gamma"]);
		const m = findBestMatch("alpha", items);
		expect(m).not.toBeNull();
		expect(m!.beginIndex).toBe(0);
		expect(m!.beginOffset).toBe(0);
	});

	it("endOffset matches needle end within item", () => {
		const items = makeItems(["hello world"]);
		const m = findBestMatch("hello world", items);
		expect(m).not.toBeNull();
		expect(m!.endIndex).toBe(0);
		expect(m!.endOffset).toBe("hello world".length);
	});

	it("threshold default 0.8 accepts 0.85 prefix match", () => {
		const items = makeItems(["hello world foo", "bar baz"]);
		const needle = "hello world foo XXXXXXXX";
		expect(findBestMatch(needle, items)).not.toBeNull(); // default 0.8 ≤ 0.85
	});
});
```

- [ ] **Step 1.2: Run tests to confirm they fail (new tests require new implementation)**

```bash
cd "d:/codingProgram/ob-plugin/dev/.obsidian/plugins/obsidian-sample-plugin-master"
npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|✓|✗|×"
```

Expected: ~4 tests fail — spanning-two-items (score now requires 1.0 not >0.8), case-insensitive (score 1.0), both prefix-fallback tests (no such path in old implementation).

- [ ] **Step 1.3: Rewrite fuzzy-matcher.ts with BMH**

Replace the full contents of `src/services/fuzzy-matcher.ts`:

```typescript
import type { PageTextItem } from "./pdf-parser";

export interface MatchSpan {
	beginIndex: number;
	beginOffset: number;
	endIndex: number;
	endOffset: number;
	score: number;
}

function norm(s: string): string {
	return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildBadCharTable(needle: string): Map<string, number> {
	const table = new Map<string, number>();
	for (let i = 0; i < needle.length - 1; i++) {
		table.set(needle[i]!, needle.length - 1 - i);
	}
	return table;
}

function bmmSearch(haystack: string, needle: string): number {
	if (needle.length === 0) return -1;
	if (needle.length > haystack.length) return -1;
	const table = buildBadCharTable(needle);
	const defaultShift = needle.length;
	let i = needle.length - 1;
	while (i < haystack.length) {
		let j = needle.length - 1;
		let k = i;
		while (j >= 0 && haystack[k] === needle[j]) {
			k--;
			j--;
		}
		if (j < 0) return k + 1; // match found
		i += table.get(haystack[i]!) ?? defaultShift;
	}
	return -1;
}

function posToSpan(
	flatStart: number,
	flatEnd: number,
	items: PageTextItem[],
	itemStarts: number[], // must be built from the same norm(item.text) lengths as flatNorm
	score: number
): MatchSpan {
	// Find which item contains flatStart (scan from end, first start <= flatStart)
	let beginArrIdx = 0;
	for (let i = itemStarts.length - 1; i >= 0; i--) {
		if ((itemStarts[i] ?? 0) <= flatStart) {
			beginArrIdx = i;
			break;
		}
	}
	// Find which item contains flatEnd - 1
	let endArrIdx = beginArrIdx;
	for (let i = beginArrIdx; i < itemStarts.length; i++) {
		const nextStart = itemStarts[i + 1] ?? Infinity;
		if (flatEnd - 1 < nextStart) {
			endArrIdx = i;
			break;
		}
	}
	const beginItem = items[beginArrIdx]!;
	const endItem = items[endArrIdx]!;
	// Offsets are into the normalised text; clamp to actual item text length
	const beginOffset = Math.min(
		flatStart - (itemStarts[beginArrIdx] ?? 0),
		beginItem.text.length
	);
	const endOffset = Math.min(
		flatEnd - (itemStarts[endArrIdx] ?? 0),
		endItem.text.length
	);
	return {
		beginIndex: beginItem.index,
		beginOffset,
		endIndex: endItem.index,
		endOffset,
		score,
	};
}

export function findBestMatch(
	needle: string,
	items: PageTextItem[],
	threshold = 0.8
): MatchSpan | null {
	if (!needle.trim() || items.length === 0) return null;

	const normNeedle = norm(needle);
	if (!normNeedle) return null;

	// Build normalised flat text and itemStarts in a single pass.
	// itemStarts[i] = start position of norm(items[i].text) in flatNorm.
	// This ensures positions from bmmSearch align perfectly with itemStarts.
	const itemStarts: number[] = [];
	let flatNorm = "";
	for (const item of items) {
		itemStarts.push(flatNorm.length);
		flatNorm += norm(item.text) + " ";
	}

	// Pass 1: exact BMH search
	const pos1 = bmmSearch(flatNorm, normNeedle);
	if (pos1 !== -1 && 1.0 >= threshold) {
		return posToSpan(pos1, pos1 + normNeedle.length, items, itemStarts, 1.0);
	}

	// Pass 2: prefix fallback — search for first 60% of normalised needle
	const prefixLen = Math.max(1, Math.floor(normNeedle.length * 0.6));
	const prefix = normNeedle.slice(0, prefixLen);
	const pos2 = bmmSearch(flatNorm, prefix);
	if (pos2 !== -1 && 0.85 >= threshold) {
		return posToSpan(pos2, pos2 + prefix.length, items, itemStarts, 0.85);
	}

	return null;
}
```

- [ ] **Step 1.4: Run tests**

```bash
npm test -- tests/fuzzy-matcher.test.ts --reporter=verbose 2>&1
```

Expected: all fuzzy-matcher tests pass.

- [ ] **Step 1.5: Run full test suite to confirm no regressions**

```bash
npm test 2>&1 | tail -8
```

Expected: all tests pass (count may differ from pre-change if old tests were replaced).

- [ ] **Step 1.6: Commit**

```bash
git add src/services/fuzzy-matcher.ts tests/fuzzy-matcher.test.ts
git commit -m "feat: replace Levenshtein fuzzy matcher with BMH algorithm"
```

---

### Task 2: Update pdf-anchor.ts to restore pages parameter + selection links

**Files:**
- Modify: `src/services/pdf-anchor.ts`
- Modify: `src/ui/analyze-modal.ts` (update buildAnchors call site to pass pages)
- Modify: `tests/report-writer.test.ts` (no change needed — renderReport tests don't touch anchors construction)

**Context:** `buildAnchors` currently takes `(results, pdfFileName, settings)` and generates only `#page=X` links. We restore the `pages: PageData[]` parameter so BMH matching can run per-result, adding `&selection=A,B,C,D` when a match is found.

- [ ] **Step 2.1: Update pdf-anchor.ts**

Replace full contents of `src/services/pdf-anchor.ts`:

```typescript
import type { PaperAnalyzerSettings } from "../settings";
import type { HighlightResult, PdfAnchor } from "../types";
import type { PageData } from "./pdf-parser";
import { findBestMatch } from "./fuzzy-matcher";

export function buildAnchors(
	results: HighlightResult[],
	pages: PageData[],
	pdfFileName: string,
	settings: PaperAnalyzerSettings
): PdfAnchor[] {
	return results.map((result) => {
		const page = pages.find((p) => p.pageNum === result.pageNum);
		const items = page?.items ?? [];
		const match = findBestMatch(result.exact_text, items);

		let link = `[[${pdfFileName}#page=${result.pageNum}`;
		if (match) {
			link += `&selection=${match.beginIndex},${match.beginOffset},${match.endIndex},${match.endOffset}`;
		}
		if (settings.useColorHighlights) {
			const color = settings.typeColorMap[result.type] ?? "yellow";
			link += `&color=${color}`;
		}
		link += "]]";

		return {
			markdownLink: link,
			exact_text: result.exact_text,
			type: result.type,
			sectionTag: result.sectionTag,
			matchScore: match?.score ?? 0,
		};
	});
}
```

- [ ] **Step 2.2: Update the buildAnchors call in analyze-modal.ts**

In `src/ui/analyze-modal.ts`, find the existing `buildAnchors` call (currently 3 arguments) and update it to pass `pages` as the second argument. The `pages` variable is already in scope from the `parsePdf` call earlier in `runAnalysis`.

Current:
```typescript
const anchors = buildAnchors(
    allResults,
    this.pdfFile.name,
    this.plugin.settings
);
```

Replace with:
```typescript
const anchors = buildAnchors(
    allResults,
    pages,
    this.pdfFile.name,
    this.plugin.settings
);
```

- [ ] **Step 2.3: Build to verify TypeScript is happy**

```bash
npm run build 2>&1 | tail -5
```

Expected: builds cleanly (no TypeScript errors).

- [ ] **Step 2.4: Run full test suite**

```bash
npm test 2>&1 | tail -8
```

Expected: all tests pass.

- [ ] **Step 2.5: Run lint**

```bash
npm run lint 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 2.6: Commit**

```bash
git add src/services/pdf-anchor.ts src/ui/analyze-modal.ts
git commit -m "feat: restore selection coordinates in PDF anchor links via BMH matching"
```

---

## Chunk 2: Types, analysis-runner, AnalyzeQueue

### Task 3: Add QueueItem type + Obsidian event declaration to types.ts

**Files:**
- Modify: `src/types.ts`

**Context:** `QueueItem` is the serialised queue entry stored in `data.json`. The `declare module "obsidian"` block adds TypeScript overloads so `app.workspace.trigger/on("paper-analyzer:queue-update")` compiles cleanly.

- [ ] **Step 3.1: Append to src/types.ts**

Add to the end of `src/types.ts`:

```typescript
export interface QueueItem {
	id: string;
	noteFile: string;
	pdfFile: string;
	status: "pending" | "running" | "done" | "error";
	addedAt: number;
	error?: string;
}

declare module "obsidian" {
	interface Workspace {
		on(
			name: "paper-analyzer:queue-update",
			callback: () => void
		): import("obsidian").EventRef;
		trigger(name: "paper-analyzer:queue-update"): void;
	}
}
```

- [ ] **Step 3.2: Build to verify no TS errors**

```bash
npm run build 2>&1 | tail -5
```

Expected: clean build.

- [ ] **Step 3.3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add QueueItem type and Obsidian workspace event declaration"
```

---

### Task 4: Add autoAnalyzeAfterImport + analyzeQueue to settings

**Files:**
- Modify: `src/settings.ts`

**Context:** Two new fields on `PaperAnalyzerSettings`. The `analyzeQueue` default is `[]`. The settings tab constructor gains a `registerEvent` call for the queue-update event. The queue UI section is added at the bottom of `display()`.

- [ ] **Step 4.1: Update PaperAnalyzerSettings interface and DEFAULT_SETTINGS**

In `src/settings.ts`, add to the `PaperAnalyzerSettings` interface:

```typescript
autoAnalyzeAfterImport: boolean;
analyzeQueue: import("./types").QueueItem[];
```

Add to `DEFAULT_SETTINGS`:

```typescript
autoAnalyzeAfterImport: false,
analyzeQueue: [],
```

- [ ] **Step 4.2: Add queue event listener in constructor**

Replace the constructor in `PaperAnalyzerSettingTab`:

```typescript
constructor(app: App, plugin: PaperAnalyzerPlugin) {
    super(app, plugin);
    this.plugin = plugin; // must be set before registerEvent
    // Bind queue-update event to plugin lifecycle — auto-cleaned on plugin unload
    this.plugin.registerEvent(
        this.app.workspace.on("paper-analyzer:queue-update", () => {
            this.renderQueueSection();
        })
    );
}
```

Add a private field at the top of the class:

```typescript
private queueSectionEl: HTMLElement | null = null;
```

- [ ] **Step 4.3: Add queue section to display()**

At the end of `display()`, just before the closing `}`, add:

```typescript
// --- Analysis queue ---
new Setting(containerEl).setName("Analysis queue").setHeading();
this.queueSectionEl = containerEl.createDiv({ cls: "paper-analyzer-queue-section" });
this.renderQueueSection();
```

- [ ] **Step 4.4: Add renderQueueSection() method**

Add to `PaperAnalyzerSettingTab`:

```typescript
private renderQueueSection(): void {
    if (!this.queueSectionEl) return;
    this.queueSectionEl.empty();

    const queue = this.plugin.analyzeQueue?.getQueue() ?? [];
    const pending = queue.filter((i) => i.status === "pending").length;
    const running = queue.find((i) => i.status === "running");
    const done = queue.filter((i) => i.status === "done").length;
    const errors = queue.filter((i) => i.status === "error").length;

    if (queue.length === 0) {
        this.queueSectionEl.createEl("p", {
            text: "No analysis tasks queued.",
            cls: "setting-item-description",
        });
        return;
    }

    if (running) {
        const name = running.pdfFile.split("/").pop() ?? running.pdfFile;
        this.queueSectionEl.createEl("p", {
            text: `Processing: ${name}`,
            cls: "setting-item-description",
        });
        const bar = this.queueSectionEl.createDiv({ cls: "paper-analyzer-progress-bar" });
        bar.createDiv({ cls: "paper-analyzer-progress-fill paper-analyzer-progress-fill--running" });
    }

    this.queueSectionEl.createEl("p", {
        text: `Pending: ${pending}   Done: ${done}   Errors: ${errors}`,
        cls: "setting-item-description",
    });

    if (done > 0 || errors > 0) {
        new Setting(this.queueSectionEl).addButton((btn) =>
            btn.setButtonText("Clear completed").onClick(async () => {
                await this.plugin.analyzeQueue?.clearDone();
            })
        );
    }
}
```

- [ ] **Step 4.5: Add analyzeQueue stub field to main.ts (no file import needed)**

`renderQueueSection()` calls `this.plugin.analyzeQueue?.getQueue()`. TypeScript needs the field declared on the plugin class. Add to `PaperAnalyzerPlugin` in `src/main.ts`:

```typescript
// Declare with structural inline type so no import of the not-yet-existing file is needed
analyzeQueue?: { getQueue(): import("./types").QueueItem[]; clearDone(): Promise<void> };
```

This satisfies TypeScript's type-checker for `renderQueueSection`'s optional-chained calls without requiring `analyze-queue.ts` to exist yet. Task 6 will replace this with the real typed field.

- [ ] **Step 4.6: Build to verify**

```bash
npm run build 2>&1 | tail -5
```

Expected: clean build.

- [ ] **Step 4.7: Run lint**

```bash
npm run lint 2>&1 | tail -5
```

Fix any lint errors (most common: `sentence-case` on new settings text). Use `// eslint-disable-next-line obsidianmd/ui/sentence-case` where needed.

- [ ] **Step 4.8: Commit**

```bash
git add src/settings.ts src/main.ts
git commit -m "feat: add analyzeQueue + autoAnalyzeAfterImport settings and queue UI section"
```

---

### Task 5: Create analysis-runner.ts

**Files:**
- Create: `src/services/analysis-runner.ts`
- Modify: `src/ui/analyze-modal.ts` (slim down to delegate to runAnalysis)

**Context:** Extract the full analysis pipeline from `AnalyzeModal.runAnalysis()` into a pure, UI-free function. The modal becomes ~25 lines. The queue will later call this same function.

- [ ] **Step 5.1: Create src/services/analysis-runner.ts**

```typescript
import type { App, TFile } from "obsidian";
import type { PaperAnalyzerSettings } from "../settings";
import type { HighlightResult, PdfAnchor, LlmConfig } from "../types";
import type { PageData } from "./pdf-parser";
import { parsePdf } from "./pdf-parser";
import { chunkPages } from "./section-chunker";
import { callLlm } from "./llm-client";
import { getPromptForChunk, runConcurrent } from "./prompt-router";
import { buildAnchors } from "./pdf-anchor";
import { appendReport } from "./report-writer";

export interface AnalysisProgress {
	done: number;
	total: number;
	message: string;
}

export type ProgressCallback = (p: AnalysisProgress) => void;

export async function runAnalysis(
	app: App,
	noteFile: TFile,
	pdfFile: TFile,
	settings: PaperAnalyzerSettings,
	onProgress?: ProgressCallback
): Promise<void> {
	const pages: PageData[] = await parsePdf(app, pdfFile);
	const chunks = chunkPages(pages).filter((c) => c.sectionTag !== "other");

	if (chunks.length === 0) {
		throw new Error("No recognizable sections found. Check PDF quality.");
	}

	const config: LlmConfig = {
		baseUrl: settings.extractionBaseUrl,
		apiKey: settings.extractionApiKey,
		model: settings.extractionModel,
	};

	let doneCount = 0;
	const allAnchors: PdfAnchor[] = [];

	const tasks = chunks.map((chunk) => async () => {
		const prompt = getPromptForChunk(chunk, settings);
		const results: HighlightResult[] = await callLlm(config, prompt, chunk);
		// Streaming: match immediately as each chunk result arrives
		const chunkAnchors = buildAnchors(results, pages, pdfFile.name, settings);
		allAnchors.push(...chunkAnchors);
		doneCount++;
		onProgress?.({
			done: doneCount,
			total: chunks.length,
			message: `${chunk.sectionTag} (${chunk.text.length} chars) → ${results.length} highlights`,
		});
		return chunkAnchors;
	});

	await runConcurrent(tasks, settings.llmConcurrency);
	await appendReport(app, noteFile, allAnchors);
}
```

- [ ] **Step 5.2: Slim down analyze-modal.ts**

Replace the full contents of `src/ui/analyze-modal.ts`:

```typescript
import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type PaperAnalyzerPlugin from "../main";
import { runAnalysis, type AnalysisProgress } from "../services/analysis-runner";

export class AnalyzeModal extends Modal {
	private plugin: PaperAnalyzerPlugin;
	private noteFile: TFile;
	private pdfFile: TFile;
	private statusEl: HTMLElement | null = null;
	private logEl: HTMLElement | null = null;
	private running = false;

	constructor(
		app: App,
		plugin: PaperAnalyzerPlugin,
		noteFile: TFile,
		pdfFile: TFile
	) {
		super(app);
		this.plugin = plugin;
		this.noteFile = noteFile;
		this.pdfFile = pdfFile;
	}

	onOpen(): void {
		const { contentEl } = this;
		new Setting(contentEl).setName("Analyze paper with AI").setHeading();
		contentEl.createEl("p", {
			text: `PDF: ${this.pdfFile.name}`,
			cls: "setting-item-description",
		});
		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Start analysis")
				.setCta()
				.onClick(() => {
					if (!this.running) void this.startAnalysis();
				})
		);
		this.statusEl = contentEl.createDiv({ cls: "paper-analyzer-status" });
		this.logEl = contentEl.createDiv({ cls: "paper-analyzer-log" });
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private log(msg: string): void {
		if (!this.logEl) return;
		this.logEl.createEl("p", { text: msg, cls: "paper-analyzer-log-line" });
		this.logEl.scrollTop = this.logEl.scrollHeight;
	}

	private setStatus(msg: string): void {
		if (this.statusEl) this.statusEl.setText(msg);
	}

	private async startAnalysis(): Promise<void> {
		this.running = true;
		const t0 = Date.now();
		const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

		try {
			await runAnalysis(
				this.app,
				this.noteFile,
				this.pdfFile,
				this.plugin.settings,
				(p: AnalysisProgress) => {
					this.setStatus(`⏳ Analyzing: ${p.done}/${p.total} chunks done`);
					this.log(`[${elapsed()}] ${p.message}`);
				}
			);
			this.setStatus(`✅ Done in ${elapsed()}`);
			new Notice(`Analysis complete (${elapsed()})`);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			this.setStatus(`❌ Error: ${msg}`);
			new Notice(`Analysis failed: ${msg}`, 6000);
		} finally {
			this.running = false;
		}
	}
}
```

- [ ] **Step 5.3: Build + lint**

```bash
npm run build 2>&1 | tail -5 && npm run lint 2>&1 | tail -5
```

Expected: both clean.

- [ ] **Step 5.4: Run full test suite**

```bash
npm test 2>&1 | tail -8
```

Expected: all tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add src/services/analysis-runner.ts src/ui/analyze-modal.ts
git commit -m "feat: extract analysis pipeline to analysis-runner.ts, slim AnalyzeModal"
```

---

### Task 6: Create analyze-queue.ts + wire into main.ts

**Files:**
- Create: `src/services/analyze-queue.ts`
- Modify: `src/main.ts`
- Modify: `src/settings.ts` (loadSettings validation)

**Context:** The queue class manages the persistent `settings.analyzeQueue` array. It runs tasks one at a time (isProcessing guard prevents re-entry). `main.ts` holds the single instance and resumes pending tasks on startup.

- [ ] **Step 6.1: Create src/services/analyze-queue.ts**

```typescript
import { TFile } from "obsidian";
import type PaperAnalyzerPlugin from "../main";
import type { QueueItem } from "../types";
import { runAnalysis } from "./analysis-runner";

export class AnalyzeQueue {
	private isProcessing = false;

	constructor(private plugin: PaperAnalyzerPlugin) {}

	async enqueue(noteFile: TFile, pdfFile: TFile): Promise<void> {
		const alreadyQueued = this.plugin.settings.analyzeQueue.some(
			(i) =>
				i.pdfFile === pdfFile.path &&
				(i.status === "pending" || i.status === "running")
		);
		if (alreadyQueued) return;

		const item: QueueItem = {
			id: Math.random().toString(36).slice(2, 10),
			noteFile: noteFile.path,
			pdfFile: pdfFile.path,
			status: "pending",
			addedAt: Date.now(),
		};
		this.plugin.settings.analyzeQueue.push(item);
		await this.plugin.saveSettings();
		this.plugin.app.workspace.trigger("paper-analyzer:queue-update");
		void this.processNext();
	}

	async processNext(): Promise<void> {
		if (this.isProcessing) return;
		const item = this.plugin.settings.analyzeQueue.find(
			(i) => i.status === "pending"
		);
		if (!item) return;

		this.isProcessing = true;
		item.status = "running";
		await this.plugin.saveSettings();
		this.plugin.app.workspace.trigger("paper-analyzer:queue-update");

		try {
			const noteFile = this.plugin.app.vault.getAbstractFileByPath(
				item.noteFile
			);
			const pdfFile = this.plugin.app.vault.getAbstractFileByPath(
				item.pdfFile
			);
			if (!(noteFile instanceof TFile) || !(pdfFile instanceof TFile)) {
				throw new Error(
					`File not found: ${item.noteFile} or ${item.pdfFile}`
				);
			}
			await runAnalysis(
				this.plugin.app,
				noteFile,
				pdfFile,
				this.plugin.settings,
				() =>
					this.plugin.app.workspace.trigger("paper-analyzer:queue-update")
			);
			item.status = "done";
		} catch (err: unknown) {
			item.status = "error";
			item.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.isProcessing = false;
			await this.plugin.saveSettings();
			this.plugin.app.workspace.trigger("paper-analyzer:queue-update");
			void this.processNext();
		}
	}

	getQueue(): QueueItem[] {
		return this.plugin.settings.analyzeQueue;
	}

	async clearDone(): Promise<void> {
		this.plugin.settings.analyzeQueue =
			this.plugin.settings.analyzeQueue.filter(
				(i) => i.status === "pending" || i.status === "running"
			);
		await this.plugin.saveSettings();
		this.plugin.app.workspace.trigger("paper-analyzer:queue-update");
	}
}
```

- [ ] **Step 6.2: Update loadSettings() in main.ts to validate the queue**

In `src/main.ts`, after the existing `typeColorMap` stale-key block, add:

```typescript
// Validate and sanitize analyzeQueue items (filter malformed, reset stuck running)
this.settings.analyzeQueue = (this.settings.analyzeQueue ?? []).filter(
    (item): item is import("./types").QueueItem =>
        typeof (item as Record<string, unknown>).id === "string" &&
        typeof (item as Record<string, unknown>).noteFile === "string" &&
        typeof (item as Record<string, unknown>).pdfFile === "string" &&
        ["pending", "running", "done", "error"].includes(
            (item as Record<string, unknown>).status as string
        )
);
this.settings.analyzeQueue.forEach((item) => {
    if (item.status === "running") item.status = "pending";
});
```

- [ ] **Step 6.3: Wire AnalyzeQueue into main.ts onload**

At the top of `src/main.ts`, add import:
```typescript
import { AnalyzeQueue } from "./services/analyze-queue";
```

Replace the stub field declaration added in Task 4:
```typescript
// remove this line:
analyzeQueue?: { getQueue(): import("./types").QueueItem[]; clearDone(): Promise<void> };
// replace with:
analyzeQueue!: AnalyzeQueue;
```

In `onload()`, after `this.addSettingTab(...)`, add:
```typescript
this.analyzeQueue = new AnalyzeQueue(this);
void this.analyzeQueue.processNext();
```

- [ ] **Step 6.4: Build + lint**

```bash
npm run build 2>&1 | tail -5 && npm run lint 2>&1 | tail -5
```

Expected: both clean.

- [ ] **Step 6.5: Run full test suite**

```bash
npm test 2>&1 | tail -8
```

Expected: all tests pass.

- [ ] **Step 6.6: Commit**

```bash
git add src/services/analyze-queue.ts src/main.ts src/settings.ts
git commit -m "feat: add AnalyzeQueue with persist/resume and isProcessing guard"
```

---

## Chunk 3: ImportModal Redesign + Styles

### Task 7: Redesign ImportModal for multi-URL batch import

**Files:**
- Modify: `src/ui/import-modal.ts` (full rewrite)
- Modify: `styles.css` (add progress bar + import row styles)

**Context:** The modal now holds a list of URL rows. Each row has its own progress bar (0–3 steps). All rows are imported concurrently (capped at 5 via `runConcurrent`). A toggle at the bottom controls `autoAnalyzeAfterImport`. After successful import, if the toggle is on, the note+PDF are enqueued for analysis.

- [ ] **Step 7.1: Replace src/ui/import-modal.ts**

```typescript
import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type PaperAnalyzerPlugin from "../main";
import {
	extractArxivId,
	fetchArxivMeta,
	downloadPdf,
	createPaperNote,
} from "../services/arxiv-client";
import { runConcurrent } from "../services/prompt-router";

interface ImportRow {
	url: string;
	status: "idle" | "running" | "done" | "error";
	stepsDone: number; // 0=none 1=metadata 2=pdf 3=note
	title?: string;
	error?: string;
	noteFile?: TFile;
	pdfFile?: TFile;
}

const STEP_LABELS = ["", "Fetching metadata…", "Downloading PDF…", "Creating note…"];

export class ImportModal extends Modal {
	private plugin: PaperAnalyzerPlugin;
	private rows: ImportRow[] = [{ url: "", status: "idle", stepsDone: 0 }];
	private rowsEl: HTMLElement | null = null;
	private progressEl: HTMLElement | null = null;
	private importing = false;

	constructor(app: App, plugin: PaperAnalyzerPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("paper-analyzer-modal");
		new Setting(contentEl).setName("Import ArXiv papers").setHeading();

		// URL input rows
		this.rowsEl = contentEl.createDiv({ cls: "paper-analyzer-url-rows" });
		this.renderRows();

		// Auto-analyze toggle
		new Setting(contentEl)
			.setName("Auto-analyze after import")
			.setDesc(
				"Queue AI highlight extraction automatically after each paper is imported."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoAnalyzeAfterImport)
					.onChange(async (value) => {
						this.plugin.settings.autoAnalyzeAfterImport = value;
						await this.plugin.saveSettings();
					})
			);

		// Import button
		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Import")
				.setCta()
				.onClick(() => {
					if (!this.importing) void this.runImport();
				})
		);

		// Per-row progress area
		this.progressEl = contentEl.createDiv({ cls: "paper-analyzer-import-progress" });
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderRows(): void {
		if (!this.rowsEl) return;
		this.rowsEl.empty();

		this.rows.forEach((row, idx) => {
			const rowEl = this.rowsEl!.createDiv({ cls: "paper-analyzer-url-row" });
			const input = rowEl.createEl("input", {
				type: "text",
				placeholder: "https://arxiv.org/abs/...",
				cls: "paper-analyzer-url-input",
			});
			input.value = row.url;
			input.addEventListener("input", () => {
				this.rows[idx]!.url = input.value;
			});
			input.addEventListener("keydown", (e: KeyboardEvent) => {
				if (e.key === "Enter" && !this.importing) void this.runImport();
			});

			// Remove button (only if more than one row)
			if (this.rows.length > 1) {
				const removeBtn = rowEl.createEl("button", {
					text: "×",
					cls: "paper-analyzer-url-remove",
				});
				removeBtn.addEventListener("click", () => {
					this.rows.splice(idx, 1);
					this.renderRows();
				});
			}
		});

		// Add row button
		const addBtn = this.rowsEl.createEl("button", {
			text: "+",
			cls: "paper-analyzer-url-add",
		});
		addBtn.addEventListener("click", () => {
			this.rows.push({ url: "", status: "idle", stepsDone: 0 });
			this.renderRows();
			// Focus the new input
			const inputs = this.rowsEl?.querySelectorAll("input");
			(inputs?.[inputs.length - 1] as HTMLInputElement | undefined)?.focus();
		});
	}

	private renderProgress(): void {
		if (!this.progressEl) return;
		this.progressEl.empty();

		for (const row of this.rows) {
			if (row.status === "idle") continue;

			const rowEl = this.progressEl.createDiv({ cls: "paper-analyzer-import-row" });

			if (row.status === "error") {
				rowEl.createEl("p", {
					text: `❌ ${row.error ?? "Unknown error"}`,
					cls: "paper-analyzer-import-row-error",
				});
				continue;
			}

			// Title or URL as label
			rowEl.createEl("p", {
				text: row.title
					? row.title.slice(0, 60)
					: row.url.slice(0, 60),
				cls: "paper-analyzer-import-row-title",
			});

			// Progress bar
			const bar = rowEl.createDiv({ cls: "paper-analyzer-progress-bar" });
			const fill = bar.createDiv({ cls: "paper-analyzer-progress-fill" });
			fill.style.width = `${(row.stepsDone / 3) * 100}%`;

			// Step label
			const stepLabel = STEP_LABELS[row.stepsDone] ?? (row.status === "done" ? "Done ✅" : "");
			rowEl.createEl("small", {
				text: row.status === "done" ? "Done ✅" : stepLabel,
				cls: "paper-analyzer-import-row-step",
			});
		}
	}

	private async importOne(row: ImportRow): Promise<void> {
		const trimmed = row.url.trim();
		const arxivId = extractArxivId(trimmed);
		if (!arxivId) {
			row.status = "error";
			row.error = `Invalid ArXiv URL: "${trimmed}"`;
			this.renderProgress();
			return;
		}

		row.status = "running";
		this.renderProgress();

		try {
			const meta = await fetchArxivMeta(arxivId);
			row.title = meta.title;
			row.stepsDone = 1;
			this.renderProgress();

			const pdfFile = await downloadPdf(
				this.app,
				meta,
				this.plugin.settings.attachmentFolderPath
			);
			row.pdfFile = pdfFile;
			row.stepsDone = 2;
			this.renderProgress();

			const noteFile = await createPaperNote(
				this.app,
				meta,
				pdfFile,
				this.plugin.settings.notesFolderPath
			);
			row.noteFile = noteFile;
			row.stepsDone = 3;
			row.status = "done";
			this.renderProgress();

			if (
				this.plugin.settings.autoAnalyzeAfterImport &&
				this.plugin.analyzeQueue
			) {
				await this.plugin.analyzeQueue.enqueue(noteFile, pdfFile);
			}
		} catch (err: unknown) {
			row.status = "error";
			row.error = err instanceof Error ? err.message : String(err);
			this.renderProgress();
		}
	}

	private async runImport(): Promise<void> {
		// Filter out blank rows
		const activeRows = this.rows.filter((r) => r.url.trim().length > 0);
		if (activeRows.length === 0) {
			new Notice("Enter at least one ArXiv URL.");
			return;
		}

		this.importing = true;
		// Reset all rows to idle for a fresh import run
		for (const row of activeRows) {
			row.status = "idle";
			row.stepsDone = 0;
			row.error = undefined;
			row.title = undefined;
		}

		const tasks = activeRows.map((row) => () => this.importOne(row));
		await runConcurrent(tasks, 5);

		const succeeded = activeRows.filter((r) => r.status === "done");
		const failed = activeRows.filter((r) => r.status === "error");
		new Notice(
			`Import complete: ${succeeded.length} succeeded, ${failed.length} failed`
		);

		// Open the first successfully imported note
		if (succeeded[0]?.noteFile) {
			await this.app.workspace.openLinkText(
				succeeded[0].noteFile.path,
				"",
				false
			);
		}

		this.importing = false;
		if (failed.length === 0) this.close();
	}
}
```

- [ ] **Step 7.2: Add styles to styles.css**

Append to `styles.css`:

```css
/* Multi-URL import modal */
.paper-analyzer-url-rows {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin-bottom: 8px;
}

.paper-analyzer-url-row {
	display: flex;
	align-items: center;
	gap: 6px;
}

.paper-analyzer-url-input {
	flex: 1;
	min-width: 0;
}

.paper-analyzer-url-remove,
.paper-analyzer-url-add {
	flex-shrink: 0;
	padding: 2px 8px;
	cursor: pointer;
	border: 1px solid var(--background-modifier-border);
	border-radius: 4px;
	background: var(--background-secondary);
}

/* Progress bars */
.paper-analyzer-progress-bar {
	width: 100%;
	height: 6px;
	background: var(--background-modifier-border);
	border-radius: 3px;
	overflow: hidden;
	margin: 4px 0;
}

.paper-analyzer-progress-fill {
	height: 100%;
	background: var(--interactive-accent);
	border-radius: 3px;
	transition: width 0.3s ease;
}

.paper-analyzer-progress-fill--running {
	width: 40%;
	animation: paper-analyzer-pulse 1.5s ease-in-out infinite;
}

@keyframes paper-analyzer-pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: 0.5; }
}

/* Import progress rows */
.paper-analyzer-import-progress {
	margin-top: 8px;
}

.paper-analyzer-import-row {
	margin-bottom: 10px;
}

.paper-analyzer-import-row-title {
	font-size: 13px;
	margin: 0 0 2px;
	font-weight: 500;
}

.paper-analyzer-import-row-step {
	font-size: 11px;
	color: var(--text-muted);
}

.paper-analyzer-import-row-error {
	font-size: 12px;
	color: var(--text-error);
	margin: 0;
}

/* Settings queue section */
.paper-analyzer-queue-section {
	margin-top: 8px;
}

/* Prompt textarea */
.paper-analyzer-prompt-textarea {
	width: 100%;
	min-height: 160px;
	font-family: var(--font-monospace);
	font-size: 12px;
	resize: vertical;
}
```

- [ ] **Step 7.3: Build + lint**

```bash
npm run build 2>&1 | tail -5 && npm run lint 2>&1 | tail -5
```

Expected: both clean. Fix any `sentence-case` lint errors with `// eslint-disable-next-line obsidianmd/ui/sentence-case`.

- [ ] **Step 7.4: Run full test suite**

```bash
npm test 2>&1 | tail -8
```

Expected: all tests pass.

- [ ] **Step 7.5: Commit**

```bash
git add src/ui/import-modal.ts styles.css
git commit -m "feat: redesign ImportModal for multi-URL batch import with progress bars"
```

---

### Task 8: Final integration verification

**Files:** No new files — verify the whole system holds together.

- [ ] **Step 8.1: Run the complete test suite one final time**

```bash
npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 8.2: Production build**

```bash
npm run build 2>&1
```

Expected: clean output with `main.js` and `pdf.worker.min.mjs` generated.

- [ ] **Step 8.3: Lint**

```bash
npm run lint 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 8.4: Final commit if any loose files**

```bash
git status
# If any modified files remain uncommitted:
git add -p
git commit -m "chore: final cleanup for Phase 4"
```

- [ ] **Step 8.5: Manual smoke test checklist**

After reloading the plugin in Obsidian:

1. Click the ribbon icon → ImportModal opens with one URL row and a `+` button
2. Add two ArXiv URLs → both rows visible, progress bars shown on Import
3. Toggle "Auto-analyze after import" on → after import, Settings page shows queue
4. Open an imported note → "Analyze current paper with AI" command works
5. In Settings → Analysis queue section shows pending/running/done counts
6. Restart Obsidian with a pending queue item → it resumes automatically
