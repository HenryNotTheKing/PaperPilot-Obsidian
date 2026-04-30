# AI Paper Analyzer — Phase 1: Import Pipeline

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to enter an ArXiv URL and automatically create a PDF attachment + Markdown note with YAML frontmatter, completing the import loop with zero manual work.

**Architecture:** Three pure service modules (`arxiv-client`, `report-writer`) driven by an `ImportModal` UI, wired into `main.ts` via a single command. No AI calls in this phase — Phase 2 adds LLM. Settings tab is fully built now so Phase 2 can use it immediately.

**Tech Stack:** Obsidian API (`requestUrl`, `vault.createBinary`, `vault.adapter.append`), Vitest for unit tests on pure logic, TypeScript strict mode.

**Spec:** `docs/superpowers/specs/2026-04-19-ai-paper-analyzer-design.md`

**Next phases:**
- Phase 2 plan: PDF parsing + LLM highlight extraction (Modules B + C)
- Phase 3 plan: Fuzzy matching + PDF selection anchors (Module D)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types.ts` | Create | All shared TypeScript interfaces and default constants |
| `src/settings.ts` | Replace | Full settings interface, defaults, and Settings Tab UI |
| `src/main.ts` | Replace | Plugin lifecycle: load settings, register one command, add ribbon icon |
| `src/services/arxiv-client.ts` | Create | ArXiv URL parsing, XML metadata fetch, PDF download, note creation |
| `src/services/report-writer.ts` | Create | Markdown report rendering + `vault.adapter.append` |
| `src/ui/import-modal.ts` | Create | Modal with URL input, step-by-step progress indicators |
| `tests/arxiv-client.test.ts` | Create | Unit tests for pure logic (URL parsing, XML parsing) |
| `tests/report-writer.test.ts` | Create | Unit tests for `renderReport` output |
| `vitest.config.ts` | Create | Vitest configuration (jsdom environment) |
| `manifest.json` | Modify | Update id, name, description, isDesktopOnly: true |
| `package.json` | Modify | Add vitest dev dependency and `test` script |
| `styles.css` | Modify | Add styles for import modal step indicators |

---

## Chunk 1: Foundation

### Task 1: Update manifest, add Vitest

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Update manifest.json**

Replace the full file contents:
```json
{
  "id": "ai-paper-analyzer",
  "name": "AI Paper Analyzer",
  "version": "0.1.0",
  "minAppVersion": "1.4.0",
  "description": "Import ArXiv papers and extract AI-powered highlights.",
  "author": "Your Name",
  "isDesktopOnly": true
}
```

- [ ] **Step 2: Add Vitest to package.json**

Run: `npm install --save-dev vitest jsdom`

Then add to the `"scripts"` section of `package.json`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest.config.ts at project root**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 4: Verify vitest runs (will find 0 tests, that's fine)**

Run: `npm test`
Expected: "No test files found" or 0 passed — no errors.

- [ ] **Step 5: Commit**

```bash
git add manifest.json package.json package-lock.json vitest.config.ts
git commit -m "chore: update manifest and add vitest test setup"
```

---

### Task 2: Create src/types.ts

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create the file**

```typescript
export type SectionTag =
  | "abstract"
  | "introduction"
  | "related_work"
  | "method"
  | "experiment"
  | "conclusion"
  | "other";

export interface TextChunk {
  pageNum: number;
  sectionTag: SectionTag;
  text: string;
  itemRange: [number, number];
}

export interface HighlightResult {
  exact_text: string;
  type: string;
  pageNum: number;
  sectionTag: SectionTag;
}

export interface PdfAnchor {
  markdownLink: string;
  exact_text: string;
  type: string;
  sectionTag: SectionTag;
  matchScore: number;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ArxivMeta {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  pdfUrl: string;
}

export const DEFAULT_TYPE_COLOR_MAP: Record<string, string> = {
  background: 'gray',
  motivation: 'yellow',
  contribution: 'green',
  limitation: 'red',
  gap: 'red',
  algorithm: 'blue',
  formula: 'purple',
  key_design: 'blue',
  baseline: 'gray',
  result: 'green',
  ablation: 'orange',
};

export const DEFAULT_PROMPTS: Record<SectionTag, string> = {
  abstract: `You are a research assistant. Extract key highlights as JSON.
RULE 1: "exact_text" MUST be copied verbatim from the input. Do not paraphrase.
RULE 2: If no relevant content found, return {"highlights": []}.
RULE 3: Never invent or hallucinate information.
Return JSON: {"highlights": [{"exact_text": "...", "type": "background|motivation|contribution"}]}
Focus: research background, problem statement, core contributions only.`,

  introduction: `You are a research assistant. Extract key highlights as JSON.
RULE 1: "exact_text" MUST be copied verbatim from the input. Do not paraphrase.
RULE 2: If no relevant content found, return {"highlights": []}.
RULE 3: Never invent or hallucinate information.
Return JSON: {"highlights": [{"exact_text": "...", "type": "background|motivation|contribution"}]}
Focus: research background, problem statement, core contributions only.`,

  related_work: `You are a research analyst. Extract prior work limitations as JSON.
RULE 1: "exact_text" must be direct quotes from the paper.
RULE 2: Output {"highlights": []} if nothing clearly fits.
Return JSON: {"highlights": [{"exact_text": "...", "type": "limitation|gap"}]}
Focus: what previous methods fail to do, what gaps remain.`,

  method: `You are a technical expert. Extract methodology highlights as JSON.
RULE 1: "exact_text" must be verbatim from the input.
RULE 2: For formulas, copy the plain text representation exactly.
RULE 3: Skip parameter derivations longer than 3 lines.
Return JSON: {"highlights": [{"exact_text": "...", "type": "algorithm|formula|key_design"}]}
Focus: algorithmic steps, key formulas, critical design choices.`,

  experiment: `You are a research evaluator. Extract quantitative results as JSON.
RULE 1: "exact_text" must be direct quotes. Numbers must be exact.
RULE 2: Return {"highlights": []} if no clear results found.
Return JSON: {"highlights": [{"exact_text": "...", "type": "baseline|result|ablation"}]}
Focus: comparison baselines, performance numbers, ablation findings.`,

  conclusion: `You are a research assistant. Extract key highlights as JSON.
RULE 1: "exact_text" MUST be copied verbatim from the input. Do not paraphrase.
RULE 2: If no relevant content found, return {"highlights": []}.
RULE 3: Never invent or hallucinate information.
Return JSON: {"highlights": [{"exact_text": "...", "type": "contribution"}]}
Focus: final stated contributions and future work directions.`,

  other: '',
};
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared types, ArxivMeta interface, and default prompt constants"
```

---

### Task 3: Replace src/settings.ts

**Files:**
- Modify: `src/settings.ts`

- [ ] **Step 1: Replace the full file**

```typescript
import { App, PluginSettingTab, Setting } from "obsidian";
import { DEFAULT_PROMPTS, DEFAULT_TYPE_COLOR_MAP, SectionTag } from "./types";
import type PaperAnalyzerPlugin from "./main";

export interface PaperAnalyzerSettings {
  attachmentFolderPath: string;
  notesFolderPath: string;

  extractionBaseUrl: string;
  extractionApiKey: string;
  extractionModel: string;

  summaryBaseUrl: string;
  summaryApiKey: string;
  summaryModel: string;

  prompts: Record<SectionTag, string>;
  typeColorMap: Record<string, string>;
  useColorHighlights: boolean;
  llmConcurrency: number;
}

export const DEFAULT_SETTINGS: PaperAnalyzerSettings = {
  attachmentFolderPath: "Papers/PDFs",
  notesFolderPath: "Papers/Notes",

  extractionBaseUrl: "https://api.siliconflow.cn/v1",
  extractionApiKey: "",
  extractionModel: "Qwen/Qwen3-8B",

  summaryBaseUrl: "https://api.siliconflow.cn/v1",
  summaryApiKey: "",
  summaryModel: "Qwen/Qwen3-8B",

  prompts: { ...DEFAULT_PROMPTS },
  typeColorMap: { ...DEFAULT_TYPE_COLOR_MAP },
  useColorHighlights: true,
  llmConcurrency: 3,
};

export class PaperAnalyzerSettingTab extends PluginSettingTab {
  plugin: PaperAnalyzerPlugin;

  constructor(app: App, plugin: PaperAnalyzerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "AI Paper Analyzer" });

    // --- File Paths ---
    containerEl.createEl("h3", { text: "File paths" });

    new Setting(containerEl)
      .setName("Attachment folder")
      .setDesc("Where to save downloaded PDFs (relative to vault root).")
      .addText(text =>
        text
          .setPlaceholder("Papers/PDFs")
          .setValue(this.plugin.settings.attachmentFolderPath)
          .onChange(async value => {
            this.plugin.settings.attachmentFolderPath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Notes folder")
      .setDesc("Where to create paper Markdown notes.")
      .addText(text =>
        text
          .setPlaceholder("Papers/Notes")
          .setValue(this.plugin.settings.notesFolderPath)
          .onChange(async value => {
            this.plugin.settings.notesFolderPath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // --- Extraction Model ---
    containerEl.createEl("h3", { text: "Extraction model" });
    containerEl.createEl("p", {
      text: "Used for per-section highlight extraction (available in Phase 2).",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("e.g. https://api.siliconflow.cn/v1  or  http://localhost:11434/v1")
      .addText(text =>
        text
          .setPlaceholder("https://api.siliconflow.cn/v1")
          .setValue(this.plugin.settings.extractionBaseUrl)
          .onChange(async value => {
            this.plugin.settings.extractionBaseUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API key")
      .addText(text => {
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.extractionApiKey)
          .onChange(async value => {
            this.plugin.settings.extractionApiKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("Model")
      .setDesc("OpenAI-compatible model name.")
      .addText(text =>
        text
          .setPlaceholder("Qwen/Qwen3-8B")
          .setValue(this.plugin.settings.extractionModel)
          .onChange(async value => {
            this.plugin.settings.extractionModel = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // --- Summary Model ---
    containerEl.createEl("h3", { text: "Summary model" });
    containerEl.createEl("p", {
      text: "Used for full-paper summary generation (available in Phase 2).",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Base URL")
      .addText(text =>
        text
          .setPlaceholder("https://api.siliconflow.cn/v1")
          .setValue(this.plugin.settings.summaryBaseUrl)
          .onChange(async value => {
            this.plugin.settings.summaryBaseUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API key")
      .addText(text => {
        text
          .setPlaceholder("sk-...")
          .setValue(this.plugin.settings.summaryApiKey)
          .onChange(async value => {
            this.plugin.settings.summaryApiKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });

    new Setting(containerEl)
      .setName("Model")
      .addText(text =>
        text
          .setPlaceholder("Qwen/Qwen3-8B")
          .setValue(this.plugin.settings.summaryModel)
          .onChange(async value => {
            this.plugin.settings.summaryModel = value.trim();
            await this.plugin.saveSettings();
          })
      );

    // --- Advanced ---
    containerEl.createEl("h3", { text: "Advanced" });

    new Setting(containerEl)
      .setName("LLM concurrency")
      .setDesc("Maximum simultaneous LLM requests (1–5). Used in Phase 2.")
      .addSlider(slider =>
        slider
          .setLimits(1, 5, 1)
          .setValue(this.plugin.settings.llmConcurrency)
          .setDynamicTooltip()
          .onChange(async value => {
            this.plugin.settings.llmConcurrency = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors (a warning about forward reference to `main.ts` is acceptable — it resolves once main.ts is updated).

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts
git commit -m "feat: implement full settings interface and settings tab"
```

---

## Chunk 2: ArXiv Client (TDD)

### Task 4: Build ArXiv Client with Tests

**Files:**
- Create: `src/services/arxiv-client.ts`
- Create: `tests/arxiv-client.test.ts`

- [ ] **Step 1: Create test file first (red phase)**

Create `tests/arxiv-client.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractArxivId, parseArxivXml, buildPdfUrl } from '../src/services/arxiv-client';

describe('extractArxivId', () => {
  it('parses abs URL', () => {
    expect(extractArxivId('https://arxiv.org/abs/2303.08774')).toBe('2303.08774');
  });

  it('strips version suffix from abs URL', () => {
    expect(extractArxivId('https://arxiv.org/abs/2303.08774v2')).toBe('2303.08774');
  });

  it('parses pdf URL', () => {
    expect(extractArxivId('https://arxiv.org/pdf/2303.08774')).toBe('2303.08774');
  });

  it('handles bare new-format ID', () => {
    expect(extractArxivId('2303.08774')).toBe('2303.08774');
  });

  it('handles 5-digit post-dot new-format ID', () => {
    expect(extractArxivId('https://arxiv.org/abs/2303.123456')).toBe('2303.123456');
  });

  it('parses old-format category/id URL', () => {
    expect(extractArxivId('https://arxiv.org/abs/cs/0610101')).toBe('cs/0610101');
  });

  it('returns null for non-ArXiv input', () => {
    expect(extractArxivId('not-an-arxiv-url')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractArxivId('')).toBeNull();
  });
});

describe('buildPdfUrl', () => {
  it('builds correct URL for new-format ID', () => {
    expect(buildPdfUrl('2303.08774')).toBe('https://arxiv.org/pdf/2303.08774');
  });

  it('builds correct URL for old-format ID', () => {
    expect(buildPdfUrl('cs/0610101')).toBe('https://arxiv.org/pdf/cs/0610101');
  });
});

describe('parseArxivXml', () => {
  const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2303.08774v1</id>
    <title>GPT-4 Technical Report</title>
    <summary>We report the development of GPT-4, a large multimodal model.</summary>
    <published>2023-03-15T00:00:00Z</published>
    <author><name>OpenAI</name></author>
    <author><name>Second Author</name></author>
    <link title="pdf" href="https://arxiv.org/pdf/2303.08774v1" rel="related" type="application/pdf"/>
  </entry>
</feed>`;

  it('extracts title', () => {
    const meta = parseArxivXml(SAMPLE_XML);
    expect(meta.title).toBe('GPT-4 Technical Report');
  });

  it('extracts abstract', () => {
    const meta = parseArxivXml(SAMPLE_XML);
    expect(meta.abstract).toContain('development of GPT-4');
  });

  it('extracts all authors', () => {
    const meta = parseArxivXml(SAMPLE_XML);
    expect(meta.authors).toEqual(['OpenAI', 'Second Author']);
  });

  it('extracts published date as YYYY-MM-DD', () => {
    const meta = parseArxivXml(SAMPLE_XML);
    expect(meta.published).toBe('2023-03-15');
  });

  it('extracts clean arxiv ID (strips version and URL prefix)', () => {
    const meta = parseArxivXml(SAMPLE_XML);
    expect(meta.id).toBe('2303.08774');
  });

  it('extracts PDF URL from link element', () => {
    const meta = parseArxivXml(SAMPLE_XML);
    expect(meta.pdfUrl).toBe('https://arxiv.org/pdf/2303.08774v1');
  });

  it('throws on malformed XML with no entry', () => {
    expect(() => parseArxivXml('<feed></feed>')).toThrow('No entry found');
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `npm test`
Expected: Error `Cannot find module '../src/services/arxiv-client'`.

- [ ] **Step 3: Create `src/services/` directory and implement arxiv-client.ts**

Create `src/services/arxiv-client.ts`:

```typescript
import { requestUrl } from "obsidian";
import type { App, TFile } from "obsidian";
import type { ArxivMeta } from "../types";

// Pure functions — testable without Obsidian API

export function extractArxivId(input: string): string | null {
  if (!input) return null;

  // New-format: 2303.08774 (4-digit year, 4-5 digit number), optional version
  const newFormat = /(?:arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5})(?:v\d+)?/i;
  const newMatch = newFormat.exec(input);
  if (newMatch?.[1]) return newMatch[1];

  // Old-format: cs/0610101 via URL
  const oldFormatUrl = /arxiv\.org\/(?:abs|pdf)\/([\w-]+\/\d+)/i;
  const oldMatchUrl = oldFormatUrl.exec(input);
  if (oldMatchUrl?.[1]) return oldMatchUrl[1];

  // Bare old-format: cs/0610101
  if (/^[\w-]+\/\d+$/.test(input)) return input;

  return null;
}

export function buildPdfUrl(id: string): string {
  return `https://arxiv.org/pdf/${id}`;
}

export function parseArxivXml(xml: string): ArxivMeta {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const entry = doc.querySelector("entry");
  if (!entry) throw new Error("No entry found in ArXiv response");

  const title = entry.querySelector("title")?.textContent?.trim() ?? "";
  const abstract = entry.querySelector("summary")?.textContent?.trim() ?? "";
  const publishedRaw = entry.querySelector("published")?.textContent?.trim() ?? "";
  const published = publishedRaw.slice(0, 10); // YYYY-MM-DD

  const authors = Array.from(entry.querySelectorAll("author > name")).map(
    el => el.textContent?.trim() ?? ""
  ).filter(Boolean);

  const rawId = entry.querySelector("id")?.textContent?.trim() ?? "";
  const id = extractArxivId(rawId) ?? rawId;

  const pdfLink = entry.querySelector('link[title="pdf"]');
  const pdfUrl = pdfLink?.getAttribute("href") ?? buildPdfUrl(id);

  return { id, title, authors, abstract, published, pdfUrl };
}

// Functions that depend on Obsidian API (not unit tested, covered by manual test)

export async function fetchArxivMeta(id: string): Promise<ArxivMeta> {
  const resp = await requestUrl({
    url: `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`,
    method: "GET",
    throw: false,
  });

  if (resp.status !== 200) {
    throw new Error(`ArXiv API returned ${resp.status}. Check your connection.`);
  }

  return parseArxivXml(resp.text);
}

export async function downloadPdf(
  app: App,
  meta: ArxivMeta,
  attachmentFolder: string
): Promise<TFile> {
  const folderPath = attachmentFolder.replace(/\/+$/, "");

  if (!app.vault.getAbstractFileByPath(folderPath)) {
    await app.vault.createFolder(folderPath);
  }

  // Replace slash for old-format IDs like cs/0610101 → cs_0610101
  const safeId = meta.id.replace(/\//g, "_");
  const fileName = `${safeId}.pdf`;
  const filePath = `${folderPath}/${fileName}`;

  const existing = app.vault.getAbstractFileByPath(filePath);
  if (existing) return existing as TFile;

  const resp = await requestUrl({
    url: meta.pdfUrl,
    method: "GET",
    throw: false,
  });

  if (resp.status !== 200) {
    throw new Error(`PDF download failed (HTTP ${resp.status}). Try opening the URL in a browser.`);
  }

  return await app.vault.createBinary(filePath, resp.arrayBuffer);
}

export async function createPaperNote(
  app: App,
  meta: ArxivMeta,
  pdfFile: TFile,
  notesFolder: string
): Promise<TFile> {
  const folderPath = notesFolder.replace(/\/+$/, "");

  if (!app.vault.getAbstractFileByPath(folderPath)) {
    await app.vault.createFolder(folderPath);
  }

  // Sanitize title for use as a filename
  const safeTitle = meta.title
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

  const notePath = `${folderPath}/${safeTitle}.md`;
  const existing = app.vault.getAbstractFileByPath(notePath);
  if (existing) return existing as TFile;

  const authorsYaml = meta.authors
    .map(a => `  - "${a.replace(/"/g, "'")}"`)
    .join("\n");

  const abstractFormatted = meta.abstract.replace(/\n+/g, " ").trim();
  const titleForFrontmatter = meta.title.replace(/"/g, "'");

  const content = `---
arxiv_id: "${meta.id}"
title: "${titleForFrontmatter}"
authors:
${authorsYaml}
published: "${meta.published}"
tags:
  - paper
  - arxiv
---

# ${meta.title}

> [!abstract]
> ${abstractFormatted}

![[${pdfFile.name}]]
`;

  return await app.vault.create(notePath, content);
}
```

- [ ] **Step 4: Run tests — confirm they pass**

Run: `npm test`
Expected: All tests PASS. Output should show something like:
```
✓ tests/arxiv-client.test.ts (11)
Test Files  1 passed (1)
Tests       11 passed (11)
```

- [ ] **Step 5: Commit**

```bash
git add src/services/arxiv-client.ts tests/arxiv-client.test.ts
git commit -m "feat: implement ArXiv client with URL parsing, XML metadata extraction, PDF download"
```

---

## Chunk 3: Report Writer and Import Modal

### Task 5: Build Report Writer with Tests

**Files:**
- Create: `src/services/report-writer.ts`
- Create: `tests/report-writer.test.ts`

- [ ] **Step 1: Write failing test first**

Create `tests/report-writer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { renderReport } from '../src/services/report-writer';
import type { PdfAnchor } from '../src/types';

const makeAnchor = (
  type: string,
  section: PdfAnchor['sectionTag'],
  text: string,
  link: string
): PdfAnchor => ({
  exact_text: text,
  type,
  sectionTag: section,
  markdownLink: link,
  matchScore: 0.9,
});

describe('renderReport', () => {
  it('returns empty string for empty anchors array', () => {
    expect(renderReport([])).toBe('');
  });

  it('includes section heading for present sections', () => {
    const anchors = [
      makeAnchor('motivation', 'abstract', 'example text', '[[p.pdf#page=1]]'),
    ];
    const output = renderReport(anchors);
    expect(output).toContain('### Abstract');
    expect(output).toContain('**[motivation]**');
    expect(output).toContain('"example text"');
    expect(output).toContain('[[p.pdf#page=1]]');
  });

  it('omits sections with no anchors', () => {
    const anchors = [
      makeAnchor('algorithm', 'method', 'key step', '[[p.pdf#page=3]]'),
    ];
    const output = renderReport(anchors);
    expect(output).not.toContain('### Abstract');
    expect(output).toContain('### Method');
  });

  it('orders sections correctly (abstract before experiment)', () => {
    const anchors = [
      makeAnchor('result', 'experiment', 'result text', '[[p.pdf#page=5]]'),
      makeAnchor('motivation', 'abstract', 'background text', '[[p.pdf#page=1]]'),
    ];
    const output = renderReport(anchors);
    const absIdx = output.indexOf('### Abstract');
    const expIdx = output.indexOf('### Experiment');
    expect(absIdx).toBeLessThan(expIdx);
  });

  it('starts with separator and section heading', () => {
    const anchors = [
      makeAnchor('contribution', 'conclusion', 'final result', '[[p.pdf#page=8]]'),
    ];
    const output = renderReport(anchors);
    expect(output).toContain('---');
    expect(output).toContain('## AI 精读报告');
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `npm test`
Expected: `Cannot find module '../src/services/report-writer'`.

- [ ] **Step 3: Implement report-writer.ts**

Create `src/services/report-writer.ts`:

```typescript
import type { App, TFile } from "obsidian";
import type { PdfAnchor, SectionTag } from "../types";

const SECTION_LABELS: Record<SectionTag, string> = {
  abstract: "Abstract",
  introduction: "Introduction",
  related_work: "Related Work",
  method: "Method",
  experiment: "Experiment & Results",
  conclusion: "Conclusion",
  other: "Other",
};

const SECTION_ORDER: SectionTag[] = [
  "abstract",
  "introduction",
  "related_work",
  "method",
  "experiment",
  "conclusion",
  "other",
];

export function renderReport(anchors: PdfAnchor[]): string {
  if (anchors.length === 0) return "";

  const bySection = new Map<SectionTag, PdfAnchor[]>();
  for (const anchor of anchors) {
    const list = bySection.get(anchor.sectionTag) ?? [];
    list.push(anchor);
    bySection.set(anchor.sectionTag, list);
  }

  const lines: string[] = ["", "---", "", "## AI 精读报告"];

  for (const tag of SECTION_ORDER) {
    const entries = bySection.get(tag);
    if (!entries || entries.length === 0) continue;

    lines.push("", `### ${SECTION_LABELS[tag]}`);
    for (const entry of entries) {
      lines.push(
        `- **[${entry.type}]** > "${entry.exact_text}" → ${entry.markdownLink}`
      );
    }
  }

  return lines.join("\n");
}

export async function appendReport(
  app: App,
  noteFile: TFile,
  anchors: PdfAnchor[]
): Promise<void> {
  const markdown = renderReport(anchors);
  if (!markdown) return;
  await app.vault.adapter.append(noteFile.path, markdown);
}
```

- [ ] **Step 4: Run all tests — confirm everything passes**

Run: `npm test`
Expected:
```
✓ tests/arxiv-client.test.ts (11)
✓ tests/report-writer.test.ts (5)
Test Files  2 passed (2)
Tests       16 passed (16)
```

- [ ] **Step 5: Commit**

```bash
git add src/services/report-writer.ts tests/report-writer.test.ts
git commit -m "feat: implement report writer with section grouping and markdown rendering"
```

---

### Task 6: Build Import Modal

**Files:**
- Create: `src/ui/import-modal.ts`
- Modify: `styles.css`

- [ ] **Step 1: Create import-modal.ts**

Create `src/ui/import-modal.ts`:

```typescript
import { App, Modal, Notice, Setting } from "obsidian";
import type PaperAnalyzerPlugin from "../main";
import {
  extractArxivId,
  fetchArxivMeta,
  downloadPdf,
  createPaperNote,
} from "../services/arxiv-client";

type StepStatus = "pending" | "running" | "done" | "error";

interface ImportStep {
  label: string;
  status: StepStatus;
  detail?: string;
}

export class ImportModal extends Modal {
  private plugin: PaperAnalyzerPlugin;
  private urlInput = "";
  private steps: ImportStep[] = [];
  private stepsEl: HTMLElement | null = null;
  private importing = false;

  constructor(app: App, plugin: PaperAnalyzerPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("paper-analyzer-modal");
    contentEl.createEl("h2", { text: "Import ArXiv paper" });

    new Setting(contentEl)
      .setName("ArXiv URL or ID")
      .setDesc("e.g. https://arxiv.org/abs/2303.08774  or  2303.08774")
      .addText(text => {
        text
          .setPlaceholder("https://arxiv.org/abs/...")
          .onChange(value => { this.urlInput = value; });
        text.inputEl.style.width = "320px";
        text.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Enter" && !this.importing) void this.runImport();
        });
      });

    new Setting(contentEl).addButton(btn =>
      btn
        .setButtonText("Import")
        .setCta()
        .onClick(() => { if (!this.importing) void this.runImport(); })
    );

    this.stepsEl = contentEl.createDiv({ cls: "paper-analyzer-steps" });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderSteps(): void {
    if (!this.stepsEl) return;
    this.stepsEl.empty();

    for (const step of this.steps) {
      const icon =
        step.status === "running" ? "⏳"
        : step.status === "done"    ? "✅"
        : step.status === "error"   ? "❌"
        : "○";

      const row = this.stepsEl.createDiv({ cls: `paper-analyzer-step paper-analyzer-step--${step.status}` });
      row.createSpan({ text: `${icon} ${step.label}` });
      if (step.detail) {
        row.createEl("small", { text: ` — ${step.detail}`, cls: "paper-analyzer-step-detail" });
      }
    }
  }

  private setStep(label: string, status: StepStatus, detail?: string): void {
    const existing = this.steps.find(s => s.label === label);
    if (existing) {
      existing.status = status;
      existing.detail = detail;
    } else {
      this.steps.push({ label, status, detail });
    }
    this.renderSteps();
  }

  private async runImport(): Promise<void> {
    const trimmed = this.urlInput.trim();
    const arxivId = extractArxivId(trimmed);
    if (!arxivId) {
      new Notice("Invalid ArXiv URL or ID. Try: https://arxiv.org/abs/2303.08774");
      return;
    }

    this.importing = true;
    this.steps = [];

    try {
      this.setStep("Fetching metadata", "running");
      const meta = await fetchArxivMeta(arxivId);
      this.setStep("Fetching metadata", "done", meta.title.slice(0, 60));

      this.setStep("Downloading PDF", "running");
      const pdfFile = await downloadPdf(
        this.app,
        meta,
        this.plugin.settings.attachmentFolderPath
      );
      this.setStep("Downloading PDF", "done", pdfFile.name);

      this.setStep("Creating note", "running");
      const noteFile = await createPaperNote(
        this.app,
        meta,
        pdfFile,
        this.plugin.settings.notesFolderPath
      );
      this.setStep("Creating note", "done", noteFile.basename);

      new Notice(`✓ Imported: ${meta.title.slice(0, 60)}`);
      await this.app.workspace.openLinkText(noteFile.path, "", false);
      this.close();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const runningStep = this.steps.find(s => s.status === "running");
      if (runningStep) {
        runningStep.status = "error";
        runningStep.detail = msg;
        this.renderSteps();
      }
      new Notice(`Import failed: ${msg}`, 6000);
    } finally {
      this.importing = false;
    }
  }
}
```

- [ ] **Step 2: Add styles to styles.css**

Append to `styles.css`:

```css
/* AI Paper Analyzer — Import Modal */
.paper-analyzer-modal .paper-analyzer-steps {
  margin-top: 12px;
  padding: 8px 0;
}

.paper-analyzer-step {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.6;
}

.paper-analyzer-step--running { color: var(--text-muted); }
.paper-analyzer-step--done    { color: var(--color-green); }
.paper-analyzer-step--error   { color: var(--color-red); }

.paper-analyzer-step-detail {
  color: var(--text-muted);
  font-size: 11px;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --skipLibCheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/ui/import-modal.ts styles.css
git commit -m "feat: implement import modal with step progress indicators"
```

---

## Chunk 4: main.ts Integration and End-to-End Test

### Task 7: Rewrite main.ts

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Replace main.ts**

```typescript
import { Plugin } from "obsidian";
import {
  DEFAULT_SETTINGS,
  PaperAnalyzerSettings,
  PaperAnalyzerSettingTab,
} from "./settings";
import { ImportModal } from "./ui/import-modal";

export default class PaperAnalyzerPlugin extends Plugin {
  settings: PaperAnalyzerSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: "import-arxiv-paper",
      name: "Import ArXiv paper",
      callback: () => {
        new ImportModal(this.app, this).open();
      },
    });

    this.addRibbonIcon("file-down", "Import ArXiv paper", () => {
      new ImportModal(this.app, this).open();
    });

    this.addSettingTab(new PaperAnalyzerSettingTab(this.app, this));
  }

  onunload(): void {}

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<PaperAnalyzerSettings>
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
```

- [ ] **Step 2: Full production build**

Run: `npm run build`
Expected: `main.js` generated, no TypeScript errors, no esbuild errors.

- [ ] **Step 3: Run all unit tests one final time**

Run: `npm test`
Expected: 16 tests pass across 2 files.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire plugin entry with import command, ribbon icon, and settings"
```

---

### Task 8: End-to-End Manual Test in Obsidian

This task has no automated tests — it validates Obsidian API interactions.

**Setup:**

- [ ] **Step 1: Build and install**

Run: `npm run build`

Copy to test vault:
```
<YourVault>/.obsidian/plugins/ai-paper-analyzer/main.js
<YourVault>/.obsidian/plugins/ai-paper-analyzer/manifest.json
<YourVault>/.obsidian/plugins/ai-paper-analyzer/styles.css
```

(Use the obsidian-cli skill if available, or copy manually.)

- [ ] **Step 2: Enable the plugin**

In Obsidian: Settings → Community plugins → toggle on **AI Paper Analyzer**.

- [ ] **Step 3: Configure paths**

Settings → AI Paper Analyzer:
- Attachment folder: `Papers/PDFs`
- Notes folder: `Papers/Notes`

- [ ] **Step 4: Happy-path import test**

1. Command Palette (Ctrl+P) → "Import ArXiv paper"
2. Enter: `https://arxiv.org/abs/2303.08774`
3. Click Import

Expected result:
- Progress steps show ✅ Fetching metadata → ✅ Downloading PDF → ✅ Creating note
- Modal closes and note opens automatically
- `Papers/PDFs/2303.08774.pdf` exists in vault
- `Papers/Notes/GPT-4 Technical Report.md` exists with:
  - YAML frontmatter: `arxiv_id`, `title`, `authors`, `published`, `tags`
  - `> [!abstract]` callout with paper abstract
  - `![[2303.08774.pdf]]` embed

- [ ] **Step 5: Duplicate import test**

Import `2303.08774` again. Expected: opens existing note, no duplicate files created.

- [ ] **Step 6: Error handling test**

1. Enter `not-a-url` → Expected: Notice "Invalid ArXiv URL or ID."
2. Enter a valid-looking but non-existent ID (e.g. `9999.99999`) → Expected: ❌ step with error message from ArXiv API.

- [ ] **Step 7: Ribbon icon test**

Click the ribbon icon (file-down icon on left sidebar) → ImportModal opens.

- [ ] **Step 8: Settings test**

Settings → AI Paper Analyzer → change folder paths → restart plugin → verify settings persisted.

- [ ] **Step 9: Final commit**

```bash
git add src/ manifest.json styles.css package.json package-lock.json vitest.config.ts
git commit -m "feat: Phase 1 complete — ArXiv import pipeline end-to-end"
```

---

## Phase 1 Complete ✓

At this point the plugin can:
- Import any ArXiv paper by URL or ID
- Download PDF to a configurable folder
- Create a Markdown note with YAML frontmatter and PDF embed
- Show step-by-step progress during import
- Handle errors gracefully with descriptive messages
- Persist all settings across restarts

**Next: Phase 2 plan** — PDF text extraction (`pdfjs-dist`) + per-section LLM highlight extraction (Modules B + C).
