# Phase 4 设计规范：多论文导入、后台分析队列、流式匹配

**日期**：2026-04-19  
**状态**：已审查  
**涉及模块**：ImportModal、fuzzy-matcher、pdf-anchor、analyze-queue、analysis-runner、settings

---

## 1. 背景与目标

本 Phase 解决四个独立问题：

1. **Bug 修复**：ribbon 按钮不弹窗（重载插件即可，无代码改动）；恢复 PDF++ selection 坐标（BMH 算法替换 Levenshtein）
2. **多 URL 导入**：ImportModal 支持批量输入多个 ArXiv URL，并行导入，每篇独立进度条
3. **后台分析队列**：导入后可选自动触发高亮分析，任务持久化到 `data.json`，重启后续跑，进度显示在设置页
4. **流式匹配**：每个 chunk LLM 返回后立即做 BMH 匹配，不等全部 chunk 完成

---

## 2. 架构变更

### 2.1 新增文件

```
src/
  services/
    analysis-runner.ts   # 从 AnalyzeModal 提取的纯分析逻辑（无 UI）
    analyze-queue.ts     # 持久化队列管理器
```

### 2.2 修改文件

| 文件 | 改动摘要 |
|------|---------|
| `src/services/fuzzy-matcher.ts` | 替换为 BMH 算法，接口不变 |
| `src/services/pdf-anchor.ts` | 恢复接收 `pages` 参数，调用 `findBestMatch`，内部按 pageNum 过滤 items |
| `src/ui/import-modal.ts` | 多 URL 输入、每行进度条、自动分析开关、并发上限 5 |
| `src/ui/analyze-modal.ts` | 改为调用 `runAnalysis`（来自 `analysis-runner.ts`） |
| `src/settings.ts` | 新增 `autoAnalyzeAfterImport`、`analyzeQueue` 字段；设置页显示队列 section |
| `src/main.ts` | onload 时初始化 `AnalyzeQueue`、重置残留 running、续跑 |
| `src/types.ts` | 新增 `QueueItem` 接口；Obsidian workspace 自定义事件类型声明 |

---

## 3. 数据模型

### 3.1 QueueItem（持久化，定义在 `types.ts`）

```typescript
export interface QueueItem {
  id: string;           // Math.random().toString(36).slice(2, 10)，无外部依赖
  noteFile: string;     // vault 相对路径
  pdfFile: string;      // vault 相对路径
  status: "pending" | "running" | "done" | "error";
  addedAt: number;      // Date.now()
  error?: string;       // 仅 error 状态时有值
}
```

**不使用 `nanoid`**，避免引入外部依赖，`Math.random().toString(36).slice(2, 10)` 已足够。

### 3.2 PaperAnalyzerSettings 新增字段

```typescript
autoAnalyzeAfterImport: boolean;   // 默认 false
analyzeQueue: QueueItem[];         // 默认 []
```

### 3.3 队列加载时的验证

`loadSettings()` 中，`analyzeQueue` 在 `Object.assign` 合并后需验证每项：

```typescript
this.settings.analyzeQueue = (this.settings.analyzeQueue ?? []).filter(
  (item): item is QueueItem =>
    typeof item.id === "string" &&
    typeof item.noteFile === "string" &&
    typeof item.pdfFile === "string" &&
    ["pending", "running", "done", "error"].includes(item.status)
);
// 将残留 running 任务重置为 pending（崩溃残留）
this.settings.analyzeQueue.forEach((item) => {
  if (item.status === "running") item.status = "pending";
});
```

### 3.4 Obsidian 自定义事件类型声明（`types.ts` 末尾）

```typescript
declare module "obsidian" {
  interface Workspace {
    on(name: "paper-analyzer:queue-update", callback: () => void): EventRef;
    trigger(name: "paper-analyzer:queue-update"): void;
  }
}
```

---

## 4. 模块详细设计

### 4.1 fuzzy-matcher.ts（替换）

**算法**：Boyer-Moore-Horspool（BMH）

```typescript
function buildBadCharTable(needle: string): Map<string, number>
// 对 needle 每个字符计算跳过距离，默认 needle.length

function bmmSearch(haystack: string, needle: string): number
// 返回首次匹配的起始位置，未找到返回 -1
```

**对外接口不变**：`findBestMatch(needle, items, threshold = 0.8) → MatchSpan | null`

**搜索流程**：
1. 归一化 needle 和 flat text（`toLowerCase().replace(/\s+/g, " ").trim()`）
2. BMH 精确搜索归一化 flat text
   - 命中：score=1.0，若 `1.0 >= threshold`，映射回 item index/offset，返回 `MatchSpan`
3. 未命中：取归一化 needle 前 60% 字符做 BMH
   - 命中：score=0.85，若 `0.85 >= threshold`，映射回 item index/offset，返回 `MatchSpan`
4. 仍未命中或 score 低于 threshold：返回 `null`

**位置映射**：复用 `posToItem(pos, items, itemStarts)` 辅助函数，逻辑与旧实现相同。

`MatchSpan` 接口不变：`{ beginIndex, beginOffset, endIndex, endOffset, score }`

### 4.2 pdf-anchor.ts（恢复 pages 参数）

```typescript
import type { PageData } from "./pdf-parser";

export function buildAnchors(
  results: HighlightResult[],
  pages: PageData[],           // 新增：用于按 pageNum 过滤 items
  pdfFileName: string,
  settings: PaperAnalyzerSettings
): PdfAnchor[]
```

**内部逻辑**：

```typescript
return results.map((result) => {
  const page = pages.find((p) => p.pageNum === result.pageNum);
  const items = page?.items ?? [];                    // 只传当页 items 给 findBestMatch
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

  return { markdownLink: link, exact_text: result.exact_text, type: result.type,
           sectionTag: result.sectionTag, matchScore: match?.score ?? 0 };
});
```

### 4.3 analysis-runner.ts（新文件）

**完整 import 列表**：

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
```

**ProgressCallback 类型**：

```typescript
export interface AnalysisProgress {
  done: number;
  total: number;
  message: string;
}

export type ProgressCallback = (p: AnalysisProgress) => void;
```

**函数签名**：

```typescript
export async function runAnalysis(
  app: App,
  noteFile: TFile,
  pdfFile: TFile,
  settings: PaperAnalyzerSettings,
  onProgress?: ProgressCallback
): Promise<void>
```

**内部流程**（流式匹配）：

```typescript
const pages: PageData[] = await parsePdf(app, pdfFile);
const chunks = chunkPages(pages).filter((c) => c.sectionTag !== "other");

const config: LlmConfig = {
  baseUrl: settings.extractionBaseUrl,
  apiKey: settings.extractionApiKey,
  model: settings.extractionModel,
};

let doneCount = 0;
const allAnchors: PdfAnchor[] = [];   // 流式累积；JS 单线程，并发 push 安全

const tasks = chunks.map((chunk) => async () => {
  const prompt = getPromptForChunk(chunk, settings);
  const results: HighlightResult[] = await callLlm(config, prompt, chunk);
  // 每个 chunk 返回后立即匹配，pages 已全部解析，按 pageNum 过滤在 buildAnchors 内完成
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
await appendReport(app, noteFile, allAnchors);   // 全部完成后一次性写入
```

**`AnalyzeModal` 更新后的 `onOpen` 和 `runAnalysis` 调用**（替换原有 140 行内联逻辑）：

```typescript
private async runAnalysis(): Promise<void> {
  this.running = true;
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  try {
    await runAnalysis(
      this.app, this.noteFile, this.pdfFile, this.plugin.settings,
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
```

### 4.4 analyze-queue.ts（新文件）

```typescript
import type PaperAnalyzerPlugin from "../main";
import type { TFile } from "obsidian";
import type { QueueItem } from "../types";
import { runAnalysis } from "./analysis-runner";

export class AnalyzeQueue {
  private isProcessing = false;   // 防止并发重入

  constructor(private plugin: PaperAnalyzerPlugin) {}

  async enqueue(noteFile: TFile, pdfFile: TFile): Promise<void> {
    // 去重：同一 PDF 已有 pending 或 running 任务则跳过
    const alreadyQueued = this.plugin.settings.analyzeQueue.some(
      (i) => i.pdfFile === pdfFile.path && (i.status === "pending" || i.status === "running")
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
    void this.processNext();    // 非阻塞触发
  }

  async processNext(): Promise<void> {
    if (this.isProcessing) return;   // 防止并发重入
    const item = this.plugin.settings.analyzeQueue.find((i) => i.status === "pending");
    if (!item) return;

    this.isProcessing = true;
    item.status = "running";
    await this.plugin.saveSettings();
    this.plugin.app.workspace.trigger("paper-analyzer:queue-update");

    try {
      const noteFile = this.plugin.app.vault.getAbstractFileByPath(item.noteFile);
      const pdfFile = this.plugin.app.vault.getAbstractFileByPath(item.pdfFile);

      if (!(noteFile instanceof TFile) || !(pdfFile instanceof TFile)) {
        throw new Error(`File not found: ${item.noteFile} or ${item.pdfFile}`);
      }

      await runAnalysis(
        this.plugin.app, noteFile, pdfFile, this.plugin.settings,
        (p) => this.plugin.app.workspace.trigger("paper-analyzer:queue-update")
      );
      item.status = "done";
    } catch (err: unknown) {
      item.status = "error";
      item.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.isProcessing = false;
      await this.plugin.saveSettings();
      this.plugin.app.workspace.trigger("paper-analyzer:queue-update");
      void this.processNext();   // 处理下一个
    }
  }

  getQueue(): QueueItem[] {
    return this.plugin.settings.analyzeQueue;
  }

  async clearDone(): Promise<void> {
    this.plugin.settings.analyzeQueue =
      this.plugin.settings.analyzeQueue.filter((i) => i.status === "pending" || i.status === "running");
    await this.plugin.saveSettings();
    this.plugin.app.workspace.trigger("paper-analyzer:queue-update");
  }
}
```

**onload 续跑**（`main.ts`，在 `loadSettings()` 之后）：

```typescript
// analyzeQueue 验证和 running→pending 重置已在 loadSettings() 内完成
this.analyzeQueue = new AnalyzeQueue(this);
void this.analyzeQueue.processNext();
```

### 4.5 ImportModal（重新设计）

**布局**：

```
┌─────────────────────────────────────────────┐
│  Import ArXiv papers                        │
├─────────────────────────────────────────────┤
│  [https://arxiv.org/abs/...]  [×]           │
│  [https://arxiv.org/abs/...]  [×]           │
│                               [+]           │
├─────────────────────────────────────────────┤
│  Auto-analyze after import    [toggle]      │
├─────────────────────────────────────────────┤
│  [Import]                                   │
├─────────────────────────────────────────────┤
│  论文标题（截断60字符）                        │
│  ████████████░░░░ Downloading PDF...  (2/3) │
│                                             │
│  Invalid URL: "abc"                ❌        │
└─────────────────────────────────────────────┘
```

**ImportRow 内部状态**：

```typescript
interface ImportRow {
  url: string;
  status: "idle" | "running" | "done" | "error";
  stepsDone: number;    // 0=none, 1=metadata, 2=pdf, 3=note
  title?: string;       // 解析到 metadata 后填充
  error?: string;
}
```

进度条：`width: ${(row.stepsDone / 3) * 100}%`，步骤文字：`["", "Fetching metadata…", "Downloading PDF…", "Creating note…"][row.stepsDone]`

**并发上限**：`Promise.all` 最多同时 5 篇（使用 `runConcurrent` from prompt-router，concurrency=5）。

**错误处理**：URL 解析失败时，直接在该行显示 "Invalid ArXiv URL" 错误，不阻塞其他行。

**自动分析**：`autoAnalyzeAfterImport` 开关值从 `plugin.settings.autoAnalyzeAfterImport` 读取，修改时调用 `plugin.saveSettings()`。导入成功后若开关开启，调用 `plugin.analyzeQueue.enqueue(noteFile, pdfFile)`。

### 4.6 设置页队列 section

在 `PaperAnalyzerSettingTab` 中：

```typescript
private queueSectionEl: HTMLElement | null = null;

constructor(app: App, plugin: PaperAnalyzerPlugin) {
  super(app, plugin);
  // registerEvent 绑定到 plugin 生命周期，插件卸载时自动清理，无需 hide() 手动 offref
  this.plugin.registerEvent(
    this.app.workspace.on("paper-analyzer:queue-update", () => this.renderQueueSection())
  );
}

display(): void {
  // ... 其他 settings ...
  new Setting(containerEl).setName("Analysis queue").setHeading();
  this.queueSectionEl = containerEl.createDiv({ cls: "paper-analyzer-queue-section" });
  this.renderQueueSection();
}

private renderQueueSection(): void {
  if (!this.queueSectionEl) return;
  this.queueSectionEl.empty();
  const queue = this.plugin.analyzeQueue.getQueue();
  // 渲染：running 项显示文件名，pending/done/error 计数，[Clear completed] 按钮
}
```

**注**：`this.plugin.registerEvent(...)` 将事件生命周期绑定到插件，插件卸载时自动 offref，不依赖 `PluginSettingTab.hide()` 这一未在 Obsidian 公开 API 中保证的回调。

---

## 5. 样式变更（styles.css）

新增：
- `.paper-analyzer-progress-bar` — 容器，灰色背景，圆角
- `.paper-analyzer-progress-fill` — 填充条，主题色 `var(--interactive-accent)`，transition
- `.paper-analyzer-import-row` — 每行导入项，flex 布局，间距
- `.paper-analyzer-queue-section` — 设置页队列区域

---

## 6. 测试计划

| 测试项 | 方式 |
|--------|------|
| BMH 精确匹配 | 单测：`findBestMatch` exact case → score=1.0 |
| BMH 归一化匹配（大小写/空格） | 单测 |
| BMH 前缀降级匹配（前60%） | 单测 → score=0.85 |
| BMH 无匹配返回 null | 单测 |
| threshold 过滤（0.9 时 0.85 降级返回 null） | 单测 |
| `buildAnchors` 生成 selection 链接 | 单测（mock pages） |
| `buildAnchors` 降级到页码链接（无匹配） | 单测 |
| 队列持久化与续跑 | 手动：重启后验证 pending 项自动处理 |
| 多 URL 并发导入 | 手动：输入 3 个 URL |
| 并发重入防护 | 手动：快速连续调用 enqueue |

---

## 7. 不在本 Phase 的内容

- LLM streaming（非 JSON 流式输出）
- 分析结果的编辑/删除
- 队列优先级调整
- 队列单条取消
