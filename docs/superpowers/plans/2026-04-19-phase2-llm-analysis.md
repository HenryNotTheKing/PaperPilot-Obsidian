# AI Paper Analyzer — Phase 2: PDF Parsing + LLM Analysis

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Analyze paper" command that parses the PDF of the currently open paper note, sends text chunks to an OpenAI-compatible LLM, and appends a structured highlight report to the note. All links use page-level anchors (`[[file.pdf#page=X]]`) in this phase; selection-level anchors are Phase 3.

**Architecture:** 4 new service modules (`pdf-parser`, `section-chunker`, `llm-client`, `prompt-router`) + one new UI modal (`analyze-modal`). The pipeline is: active-note frontmatter → PDF binary → TextChunk[] → HighlightResult[] → PdfAnchor[] → append markdown. A concurrency pool limits simultaneous LLM requests.

**Tech Stack:** `pdfjs-dist` (npm, worker disabled via legacy build), `requestUrl()` for LLM HTTP calls, Obsidian `vault.readBinary()` for PDF bytes, TypeScript strict mode, Vitest for pure-logic unit tests.

**Spec:** `docs/superpowers/specs/2026-04-19-ai-paper-analyzer-design.md` (sections 4.2, 4.3)

**Phase 1 prerequisite:** All Phase 1 tasks complete and passing (22 tests, lint clean, build passes).

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/services/pdf-parser.ts` | Create | Load PDF via pdfjs-dist, extract per-page text items |
| `src/services/section-chunker.ts` | Create | Heuristic section detection, split into ~800-token TextChunk[] |
| `src/services/llm-client.ts` | Create | Single-function requestUrl wrapper for /v1/chat/completions |
| `src/services/prompt-router.ts` | Create | Map SectionTag → system prompt string from settings |
| `src/ui/analyze-modal.ts` | Create | Progress modal driven by the analysis pipeline |
| `src/main.ts` | Modify | Register "Analyze paper" command |
| `tests/section-chunker.test.ts` | Create | Unit tests for section heuristics (pure logic) |
| `tests/llm-client.test.ts` | Create | Unit tests for JSON response parsing (pure logic) |
| `package.json` | Modify | Add `pdfjs-dist` dependency |
| `tests/__mocks__/obsidian.ts` | Modify | Export `TFile`, `Notice` stubs needed by new modules |

---

## Chunk 1: Install pdfjs-dist and PDF Parser (TDD)

### Task 1: Install pdfjs-dist

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install pdfjs-dist**

Run: `npm install pdfjs-dist`

Expected: `pdfjs-dist` appears in `dependencies` in package.json, no errors.

- [ ] **Step 2: Verify build still passes**

Run: `npm run build`
Expected: `main.js` generated, no errors. (esbuild bundles pdfjs-dist automatically.)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add pdfjs-dist dependency for PDF text extraction"
```

---

### Task 2: Create PDF Parser (with mock test)

**Files:**
- Create: `src/services/pdf-parser.ts`
- Create: `tests/pdf-parser.test.ts`

- [ ] **Step 1: Create pdf-parser.ts**

```typescript
import type { App, TFile } from "obsidian";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export interface PageTextItem {
	text: string;
	height: number;
	pageNum: number;
	index: number;
}

export interface PageData {
	pageNum: number;
	items: PageTextItem[];
	fullText: string;
}

export async function parsePdf(app: App, pdfFile: TFile): Promise<PageData[]> {
	const bytes = await app.vault.readBinary(pdfFile);
	return parsePdfBytes(bytes);
}

export async function parsePdfBytes(bytes: ArrayBuffer): Promise<PageData[]> {
	// pdfjs-dist: disable web worker (not available in Obsidian's worker context)
	const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
	pdfjsLib.GlobalWorkerOptions.workerSrc = "";

	const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
	const doc = await loadingTask.promise;

	const pages: PageData[] = [];

	for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
		const page = await doc.getPage(pageNum);
		const content = await page.getTextContent();

		const items: PageTextItem[] = [];
		let fullText = "";

		content.items.forEach((rawItem, index) => {
			const item = rawItem as TextItem;
			if (!item.str) return;

			const height = item.height ?? 0;
			items.push({ text: item.str, height, pageNum, index });
			fullText += item.str + (item.hasEOL ? "\n" : " ");
		});

		pages.push({ pageNum, items, fullText });
	}

	return pages;
}
```

- [ ] **Step 2: Write a smoke test (mocks pdfjs-dist)**

Create `tests/pdf-parser.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { parsePdfBytes } from "../src/services/pdf-parser";

// Mock pdfjs-dist legacy build
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
	default: undefined,
	GlobalWorkerOptions: { workerSrc: "" },
	getDocument: () => ({
		promise: Promise.resolve({
			numPages: 2,
			getPage: (pageNum: number) =>
				Promise.resolve({
					getTextContent: () =>
						Promise.resolve({
							items: [
								{ str: `Page ${pageNum} text`, height: 12, hasEOL: false },
								{ str: " more text", height: 12, hasEOL: true },
							],
						}),
				}),
		}),
	}),
}));

describe("parsePdfBytes", () => {
	it("returns one PageData per page", async () => {
		const pages = await parsePdfBytes(new ArrayBuffer(0));
		expect(pages).toHaveLength(2);
	});

	it("assigns correct pageNum to each page", async () => {
		const pages = await parsePdfBytes(new ArrayBuffer(0));
		expect(pages[0]?.pageNum).toBe(1);
		expect(pages[1]?.pageNum).toBe(2);
	});

	it("extracts text items with height and index", async () => {
		const pages = await parsePdfBytes(new ArrayBuffer(0));
		expect(pages[0]?.items[0]?.text).toBe("Page 1 text");
		expect(pages[0]?.items[0]?.height).toBe(12);
	});

	it("builds fullText string per page", async () => {
		const pages = await parsePdfBytes(new ArrayBuffer(0));
		expect(pages[0]?.fullText).toContain("Page 1 text");
	});
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 4 new tests pass (total ≥ 26).

- [ ] **Step 4: Commit**

```bash
git add src/services/pdf-parser.ts tests/pdf-parser.test.ts
git commit -m "feat: implement PDF text parser using pdfjs-dist"
```

---

## Chunk 2: Section Chunker (TDD)

### Task 3: Create Section Chunker with Tests

**Files:**
- Create: `src/services/section-chunker.ts`
- Create: `tests/section-chunker.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `tests/section-chunker.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
	detectSectionTag,
	chunkPages,
} from "../src/services/section-chunker";
import type { PageData } from "../src/services/pdf-parser";

describe("detectSectionTag", () => {
	it("detects abstract section", () => {
		expect(detectSectionTag("Abstract")).toBe("abstract");
	});

	it("detects introduction section", () => {
		expect(detectSectionTag("1. Introduction")).toBe("introduction");
	});

	it("detects related work", () => {
		expect(detectSectionTag("2 Related Work")).toBe("related_work");
	});

	it("detects method section", () => {
		expect(detectSectionTag("3. Methodology")).toBe("method");
	});

	it("detects experiment section", () => {
		expect(detectSectionTag("4. Experiments")).toBe("experiment");
	});

	it("detects conclusion section", () => {
		expect(detectSectionTag("5. Conclusion")).toBe("conclusion");
	});

	it("returns null for normal body text", () => {
		expect(detectSectionTag("This paper proposes a method")).toBeNull();
	});

	it("is case-insensitive", () => {
		expect(detectSectionTag("INTRODUCTION")).toBe("introduction");
	});
});

describe("chunkPages", () => {
	const makePage = (pageNum: number, text: string): PageData => ({
		pageNum,
		items: [{ text, height: 12, pageNum, index: 0 }],
		fullText: text,
	});

	it("returns at least one chunk for non-empty pages", () => {
		const pages = [makePage(1, "This is some content.".repeat(20))];
		const chunks = chunkPages(pages);
		expect(chunks.length).toBeGreaterThan(0);
	});

	it("assigns sectionTag to chunks", () => {
		const pages = [
			makePage(1, "Abstract"),
			makePage(1, "This paper is about AI."),
		];
		const chunks = chunkPages(pages);
		const abstractChunk = chunks.find((c) => c.sectionTag === "abstract");
		expect(abstractChunk).toBeDefined();
	});

	it("uses 'other' tag before first section heading", () => {
		const pages = [makePage(1, "Some preamble text without a section.")];
		const chunks = chunkPages(pages);
		// All chunks before a section header get tag "other"
		expect(chunks.every((c) => c.sectionTag === "other")).toBe(true);
	});

	it("keeps pageNum from source page", () => {
		const pages = [makePage(5, "Some content here.")];
		const chunks = chunkPages(pages);
		expect(chunks[0]?.pageNum).toBe(5);
	});

	it("returns empty array for empty pages", () => {
		expect(chunkPages([])).toEqual([]);
	});
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `npm test`
Expected: `Cannot find module '../src/services/section-chunker'`

- [ ] **Step 3: Implement section-chunker.ts**

Create `src/services/section-chunker.ts`:

```typescript
import type { SectionTag, TextChunk } from "../types";
import type { PageData } from "./pdf-parser";

const SECTION_PATTERNS: Array<{ pattern: RegExp; tag: SectionTag }> = [
	{ pattern: /^\s*abstract\s*$/i, tag: "abstract" },
	{ pattern: /^\s*\d*\.?\s*introduction\s*$/i, tag: "introduction" },
	{
		pattern: /^\s*\d*\.?\s*(related\s*work|background|prior\s*work)\s*$/i,
		tag: "related_work",
	},
	{
		pattern:
			/^\s*\d*\.?\s*(method|methodology|approach|model|framework|proposed)\s*$/i,
		tag: "method",
	},
	{
		pattern:
			/^\s*\d*\.?\s*(experiment|evaluation|results|analysis|ablation)\s*$/i,
		tag: "experiment",
	},
	{
		pattern:
			/^\s*\d*\.?\s*(conclusion|discussion|summary|future\s*work)\s*$/i,
		tag: "conclusion",
	},
	{ pattern: /^\s*\d*\.?\s*references\s*$/i, tag: "other" },
];

const MAX_CHUNK_CHARS = 3200;

export function detectSectionTag(text: string): SectionTag | null {
	const trimmed = text.trim();
	if (!trimmed || trimmed.length > 80) return null;

	for (const { pattern, tag } of SECTION_PATTERNS) {
		if (pattern.test(trimmed)) return tag;
	}
	return null;
}

export function chunkPages(pages: PageData[]): TextChunk[] {
	if (pages.length === 0) return [];

	const chunks: TextChunk[] = [];
	let currentTag: SectionTag = "other";
	let currentText = "";
	let currentPageNum = 1;
	let currentItemStart = 0;
	let currentItemEnd = 0;

	function flushChunk() {
		const trimmed = currentText.trim();
		if (trimmed.length === 0) return;
		chunks.push({
			pageNum: currentPageNum,
			sectionTag: currentTag,
			text: trimmed,
			itemRange: [currentItemStart, currentItemEnd],
		});
	}

	for (const page of pages) {
		for (const item of page.items) {
			const detected = detectSectionTag(item.text);

			if (detected !== null) {
				// Section heading detected — flush current chunk and start new section
				flushChunk();
				currentText = "";
				currentTag = detected;
				currentPageNum = item.pageNum;
				currentItemStart = item.index;
				currentItemEnd = item.index;
				continue;
			}

			if (currentText === "") {
				currentPageNum = item.pageNum;
				currentItemStart = item.index;
			}

			currentText += item.text + " ";
			currentItemEnd = item.index;

			// Split into new chunk if exceeding size limit
			if (currentText.length > MAX_CHUNK_CHARS) {
				flushChunk();
				currentText = "";
				currentItemStart = item.index;
			}
		}
	}

	flushChunk();
	return chunks;
}
```

- [ ] **Step 4: Run tests — confirm all pass**

Run: `npm test`
Expected: All tests pass. The section-chunker suite should show ≥ 9 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/section-chunker.ts tests/section-chunker.test.ts
git commit -m "feat: implement heuristic section chunker for academic PDFs"
```

---

## Chunk 3: LLM Client + Prompt Router (TDD)

### Task 4: Build LLM Client with Tests

**Files:**
- Create: `src/services/llm-client.ts`
- Create: `tests/llm-client.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `tests/llm-client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseHighlights, buildRequestBody } from "../src/services/llm-client";

describe("parseHighlights", () => {
	it("extracts highlights from valid JSON string", () => {
		const json = JSON.stringify({
			highlights: [
				{ exact_text: "Attention is all you need.", type: "contribution" },
			],
		});
		const result = parseHighlights(json, 1, "abstract");
		expect(result).toHaveLength(1);
		expect(result[0]?.exact_text).toBe("Attention is all you need.");
		expect(result[0]?.pageNum).toBe(1);
		expect(result[0]?.sectionTag).toBe("abstract");
	});

	it("returns empty array for JSON with no highlights key", () => {
		const result = parseHighlights("{}", 1, "method");
		expect(result).toEqual([]);
	});

	it("returns empty array on malformed JSON", () => {
		const result = parseHighlights("not json", 1, "experiment");
		expect(result).toEqual([]);
	});

	it("filters out highlights with empty exact_text", () => {
		const json = JSON.stringify({
			highlights: [
				{ exact_text: "", type: "contribution" },
				{ exact_text: "Valid text.", type: "motivation" },
			],
		});
		const result = parseHighlights(json, 1, "abstract");
		expect(result).toHaveLength(1);
		expect(result[0]?.exact_text).toBe("Valid text.");
	});
});

describe("buildRequestBody", () => {
	it("includes model, messages, and response_format", () => {
		const body = buildRequestBody("gpt-4", "system prompt", "user content");
		expect(body.model).toBe("gpt-4");
		expect(body.messages).toHaveLength(2);
		expect(body.response_format).toEqual({ type: "json_object" });
	});

	it("sets temperature to 0.1", () => {
		const body = buildRequestBody("model", "sys", "usr");
		expect(body.temperature).toBe(0.1);
	});
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `npm test`
Expected: `Cannot find module '../src/services/llm-client'`

- [ ] **Step 3: Implement llm-client.ts**

Create `src/services/llm-client.ts`:

```typescript
import { requestUrl } from "obsidian";
import type { HighlightResult, LlmConfig, SectionTag, TextChunk } from "../types";

interface ChatRequestBody {
	model: string;
	messages: Array<{ role: string; content: string }>;
	response_format: { type: string };
	temperature: number;
	max_tokens: number;
}

interface ChatResponse {
	choices: Array<{
		message: { content: string };
	}>;
}

export function buildRequestBody(
	model: string,
	systemPrompt: string,
	userContent: string
): ChatRequestBody {
	return {
		model,
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userContent },
		],
		response_format: { type: "json_object" },
		temperature: 0.1,
		max_tokens: 2048,
	};
}

export function parseHighlights(
	jsonStr: string,
	pageNum: number,
	sectionTag: SectionTag
): HighlightResult[] {
	try {
		const parsed = JSON.parse(jsonStr) as { highlights?: unknown[] };
		if (!Array.isArray(parsed.highlights)) return [];
		return parsed.highlights
			.filter(
				(h): h is { exact_text: string; type: string } =>
					typeof (h as Record<string, unknown>).exact_text === "string" &&
					(h as Record<string, unknown>).exact_text !== "" &&
					typeof (h as Record<string, unknown>).type === "string"
			)
			.map((h) => ({
				exact_text: h.exact_text,
				type: h.type,
				pageNum,
				sectionTag,
			}));
	} catch {
		return [];
	}
}

export async function callLlm(
	config: LlmConfig,
	systemPrompt: string,
	chunk: TextChunk
): Promise<HighlightResult[]> {
	if (!systemPrompt) return []; // "other" sections have empty prompt

	const body = buildRequestBody(
		config.model,
		systemPrompt,
		`Section: ${chunk.sectionTag}\n\n${chunk.text}`
	);

	const resp = await requestUrl({
		url: `${config.baseUrl}/chat/completions`,
		method: "POST",
		headers: {
			Authorization: `Bearer ${config.apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		throw: false,
	});

	if (resp.status !== 200) {
		throw new Error(`LLM API returned ${resp.status}: ${resp.text.slice(0, 200)}`);
	}

	const json = resp.json as ChatResponse;
	const content = json.choices[0]?.message?.content ?? "{}";
	return parseHighlights(content, chunk.pageNum, chunk.sectionTag);
}
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass. New llm-client suite: ≥ 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/services/llm-client.ts tests/llm-client.test.ts
git commit -m "feat: implement OpenAI-compatible LLM client with JSON response parsing"
```

---

### Task 5: Create Prompt Router

**Files:**
- Create: `src/services/prompt-router.ts`

- [ ] **Step 1: Implement prompt-router.ts**

```typescript
import type { SectionTag, TextChunk } from "../types";
import type { PaperAnalyzerSettings } from "../settings";

export function getPromptForChunk(
	chunk: TextChunk,
	settings: PaperAnalyzerSettings
): string {
	const SECTION_ROUTES: Record<SectionTag, SectionTag> = {
		abstract: "abstract",
		introduction: "introduction",
		related_work: "related_work",
		method: "method",
		experiment: "experiment",
		conclusion: "conclusion",
		other: "other",
	};

	const key = SECTION_ROUTES[chunk.sectionTag];
	return settings.prompts[key] ?? "";
}

export async function runConcurrent<T>(
	tasks: Array<() => Promise<T>>,
	concurrency: number
): Promise<T[]> {
	const results: T[] = [];
	let index = 0;

	async function worker() {
		while (index < tasks.length) {
			const taskIndex = index++;
			const task = tasks[taskIndex];
			if (task) {
				results[taskIndex] = await task();
			}
		}
	}

	const workers = Array.from({ length: concurrency }, () => worker());
	await Promise.all(workers);
	return results;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/prompt-router.ts
git commit -m "feat: add prompt router and concurrent task runner"
```

---

## Chunk 4: Analyze Modal + Pipeline Integration

### Task 6: Build Analyze Modal

**Files:**
- Create: `src/ui/analyze-modal.ts`

- [ ] **Step 1: Create analyze-modal.ts**

```typescript
import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type PaperAnalyzerPlugin from "../main";
import { parsePdf } from "../services/pdf-parser";
import { chunkPages } from "../services/section-chunker";
import { callLlm } from "../services/llm-client";
import { getPromptForChunk, runConcurrent } from "../services/prompt-router";
import { appendReport } from "../services/report-writer";
import type { PdfAnchor, HighlightResult } from "../types";

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
					if (!this.running) void this.runAnalysis();
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

	private async runAnalysis(): Promise<void> {
		this.running = true;

		try {
			// Step 1: Parse PDF
			this.setStatus("⏳ Parsing PDF...");
			const pages = await parsePdf(this.app, this.pdfFile);
			this.log(`Extracted ${pages.length} pages`);

			// Step 2: Chunk into sections
			this.setStatus("⏳ Detecting sections...");
			const chunks = chunkPages(pages).filter(
				(c) => c.sectionTag !== "other"
			);
			this.log(`Found ${chunks.length} content chunks`);

			// Step 3: LLM extraction (concurrent)
			const config = {
				baseUrl: this.plugin.settings.extractionBaseUrl,
				apiKey: this.plugin.settings.extractionApiKey,
				model: this.plugin.settings.extractionModel,
			};

			let doneCount = 0;
			const allResults: HighlightResult[] = [];

			const tasks = chunks.map((chunk) => async () => {
				const prompt = getPromptForChunk(chunk, this.plugin.settings);
				const results = await callLlm(config, prompt, chunk);
				doneCount++;
				this.setStatus(
					`⏳ Analyzing: ${doneCount}/${chunks.length} chunks done`
				);
				return results;
			});

			this.setStatus(`⏳ Analyzing: 0/${chunks.length} chunks done`);
			const resultSets = await runConcurrent(
				tasks,
				this.plugin.settings.llmConcurrency
			);
			resultSets.forEach((r) => allResults.push(...r));

			this.log(`Extracted ${allResults.length} highlights`);

			// Step 4: Build page-level anchors (Phase 2 — no selection coords yet)
			const anchors: PdfAnchor[] = allResults.map((r) => ({
				markdownLink: `[[${this.pdfFile.name}#page=${r.pageNum}]]`,
				exact_text: r.exact_text,
				type: r.type,
				sectionTag: r.sectionTag,
				matchScore: 1,
			}));

			// Step 5: Append report to note
			this.setStatus("⏳ Writing report...");
			await appendReport(this.app, this.noteFile, anchors);

			this.setStatus("✅ Done! Report appended to note.");
			new Notice(`Analysis complete: ${allResults.length} highlights extracted`);
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

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/analyze-modal.ts
git commit -m "feat: implement AI analysis modal with PDF parse, LLM extraction, report append"
```

---

### Task 7: Wire "Analyze paper" Command in main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add the analyze command**

The command should:
1. Get the active markdown file
2. Read its frontmatter for `arxiv_id`
3. Build the PDF path from settings + arxiv_id
4. Open `AnalyzeModal`

Add this import and command to `src/main.ts`:

```typescript
// Add imports at top:
import { AnalyzeModal } from "./ui/analyze-modal";
import { TFile } from "obsidian";
```

Add this command inside `onload()` after the import command:

```typescript
		this.addCommand({
			id: "analyze-arxiv-paper",
			name: "Analyze current paper with AI",
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile || activeFile.extension !== "md") return false;

				if (!checking) {
					void this.launchAnalysis(activeFile);
				}
				return true;
			},
		});
```

Add this helper method to the plugin class:

```typescript
	private async launchAnalysis(noteFile: TFile): Promise<void> {
		const cache = this.app.metadataCache.getFileCache(noteFile);
		const arxivId = cache?.frontmatter?.["arxiv_id"] as string | undefined;

		if (!arxivId) {
			new Notice("No arxiv_id found in note frontmatter. Import via 'Import arxiv paper' first.");
			return;
		}

		const safeId = arxivId.replace(/\//g, "_");
		const pdfPath = `${this.settings.attachmentFolderPath}/${safeId}.pdf`;
		const pdfFile = this.app.vault.getAbstractFileByPath(pdfPath);

		if (!(pdfFile instanceof TFile)) {
			new Notice(`PDF not found at: ${pdfPath}`);
			return;
		}

		new AnalyzeModal(this.app, this, noteFile, pdfFile).open();
	}
```

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass. No regressions.

- [ ] **Step 3: Full build**

Run: `npm run build`
Expected: `main.js` generated, no errors.

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: No errors. (If any sentence-case errors appear on new UI text, fix them following the same pattern as Phase 1.)

- [ ] **Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: add 'Analyze current paper with AI' command wired to analysis pipeline"
```

---

### Task 8: Update styles.css for analyze modal

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Add analyze modal styles**

Append to `styles.css`:

```css
/* AI Paper Analyzer — Analyze Modal */
.paper-analyzer-status {
	font-weight: 600;
	margin: 8px 0;
	padding: 4px 0;
}

.paper-analyzer-log {
	max-height: 200px;
	overflow-y: auto;
	padding: 4px 8px;
	background: var(--background-secondary);
	border-radius: 4px;
	margin-top: 8px;
}

.paper-analyzer-log-line {
	font-size: 12px;
	margin: 2px 0;
	color: var(--text-muted);
	font-family: var(--font-monospace);
}
```

- [ ] **Step 2: Commit**

```bash
git add styles.css
git commit -m "feat: add analyze modal styles"
```

---

### Task 9: End-to-End Manual Test in Obsidian

**Setup:**

- [ ] **Step 1: Build and deploy**

Run: `npm run build`

Copy to test vault:
```
<YourVault>/.obsidian/plugins/ai-paper-analyzer/main.js
<YourVault>/.obsidian/plugins/ai-paper-analyzer/manifest.json
<YourVault>/.obsidian/plugins/ai-paper-analyzer/styles.css
```

Reload Obsidian (Ctrl+R or disable/re-enable plugin).

- [ ] **Step 2: Configure LLM**

Settings → AI Paper Analyzer → Extraction model:
- Base URL: `https://api.siliconflow.cn/v1` (or your provider)
- API key: your key
- Model: `Qwen/Qwen3-8B` (or any model supporting JSON output)

- [ ] **Step 3: Import a paper first**

If not already imported: run "Import arxiv paper" → `https://arxiv.org/abs/2303.08774`

- [ ] **Step 4: Run analysis**

1. Open the paper note `GPT-4 Technical Report.md`
2. Command Palette → "Analyze current paper with AI"
3. Click "Start analysis"

Expected:
- Modal shows progress: parsing → sections → analyzing X/Y chunks → writing report
- Note now has `## AI 精读报告` section appended
- Report has section headings (Abstract, Method, etc.) with bullet lines like:
  `- **[motivation]** > "exact text from paper" → [[2303.08774.pdf#page=3]]`

- [ ] **Step 5: Verify error case**

Open a non-paper note (no frontmatter) → Run command → expect Notice "No arxiv_id found..."

- [ ] **Step 6: Final commit**

```bash
git add src/ styles.css
git commit -m "feat: Phase 2 complete — PDF parsing and LLM analysis pipeline"
```

---

## Phase 2 Complete ✓

After this phase the plugin can:
- Parse any imported ArXiv PDF into text chunks via pdfjs-dist
- Detect academic section boundaries heuristically
- Call any OpenAI-compatible LLM API per chunk with dynamic section prompts
- Append a structured AI highlight report with page-level PDF links

**Next: Phase 3** — Obsidian internal PDF.js access for selection-level anchors + PDF++ color integration (Module D).
