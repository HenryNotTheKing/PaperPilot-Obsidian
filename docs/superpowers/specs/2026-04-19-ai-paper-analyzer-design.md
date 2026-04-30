# AI Paper Analyzer & Importer — 设计规范

**日期**: 2026-04-19  
**状态**: 草稿  
**目标受众**: 插件开发者

---

## 1. 背景与目标

### 1.1 问题陈述

科研人员在阅读 ArXiv 学术论文时面临三重摩擦：
1. **导入摩擦**：手动下载 PDF、创建笔记、填写元数据耗时且易遗漏
2. **阅读摩擦**：精读双栏 PDF 并提炼关键句需要大量人工投入
3. **回溯摩擦**：笔记中的结论无法快速定位到 PDF 原文位置

### 1.2 目标

构建一个 Obsidian 社区插件，实现：
- **一键导入**：ArXiv URL → PDF + Markdown 笔记自动创建
- **AI 精读**：调用本地/云端 LLM 按章节提取关键句（exact text）
- **原文回溯**：每条提炼结论附带可点击的 PDF 原文高亮链接

### 1.3 约束

- 仅支持桌面端（`isDesktopOnly: true`）
- 不依赖特定 LLM 提供商，支持任意 OpenAI 兼容 API
- 最小化捆绑依赖，保持插件体积可控

---

## 2. 架构总览

### 2.1 技术栈

| 层次 | 技术选型 | 原因 |
|------|---------|------|
| 网络请求 | Obsidian `requestUrl()` | 绕过 CORS；官方审查要求 |
| PDF 文本提取（Module B） | `pdfjs-dist`（npm 包） | 供 LLM 分析用，不需要精确坐标 |
| PDF 坐标提取（Module D） | Obsidian 内置 PDF.js | 唯一能生成兼容 selection 参数的方式 |
| LLM 接入 | OpenAI 兼容 `/v1/chat/completions` | 支持 SiliconFlow、Ollama、OpenAI 等所有厂商 |
| 颜色高亮（可选） | PDF++ 插件软依赖 | `&color=` 参数由 PDF++ 解释；无 PDF++ 则降级 |
| 文件写入 | `vault.adapter.append()` | 非阻塞追加 |
| 设置持久化 | `this.loadData() / this.saveData()` | Obsidian 标准 |

### 2.2 文件结构

```
src/
  main.ts              # 插件生命周期 + 命令注册（< 80 行）
  settings.ts          # Settings 接口 + 默认值 + SettingsTab UI
  types.ts             # 所有共享 TypeScript 接口

  services/
    arxiv-client.ts    # ArXiv XML API 查询 + PDF 二进制下载
    pdf-parser.ts      # pdfjs-dist 文本提取（逐页 TextItem[]）
    section-chunker.ts # 启发式章节识别 + Chunk 分割
    llm-client.ts      # OpenAI 兼容 API 调用（requestUrl）
    prompt-router.ts   # SectionTag → System Prompt 路由
    pdf-anchor.ts      # Obsidian 内置 PDF.js 坐标提取 + 链接生成
    fuzzy-matcher.ts   # Levenshtein 距离模糊匹配
    report-writer.ts   # Markdown 聚合 + vault.adapter.append

  ui/
    import-modal.ts    # ArXiv URL 输入 Modal + 实时进度状态
```

---

## 3. 数据模型（types.ts）

```typescript
type SectionTag =
  | "abstract"
  | "introduction"
  | "related_work"
  | "method"
  | "experiment"
  | "conclusion"
  | "other";

// Module B 产出：每个分块携带页码和章节标签
interface TextChunk {
  pageNum: number;           // 1-based
  sectionTag: SectionTag;
  text: string;              // 纯文本，约 800 token
  itemRange: [number, number]; // pdfjs items 数组的 [startIdx, endIdx]
}

// Module C 产出：LLM 返回的结构化提取结果
interface HighlightResult {
  exact_text: string;        // 模型摘抄的原文句子
  type: string;              // 语义类型，见下方类型表
  pageNum: number;           // 来源页码（从 TextChunk 继承）
  sectionTag: SectionTag;
}

// Module D 产出：最终 PDF 锚点链接
interface PdfAnchor {
  markdownLink: string;      // [[file.pdf#page=X&selection=A,B,C,D&color=yellow]]
  exact_text: string;
  type: string;
  sectionTag: SectionTag;
  matchScore: number;        // 0-1，模糊匹配置信度
}

// 插件完整设置
interface PaperAnalyzerSettings {
  attachmentFolderPath: string;
  notesFolderPath: string;

  // 提取模型（用于按章节分析各 Chunk）
  extractionBaseUrl: string;
  extractionApiKey: string;
  extractionModel: string;

  // 总结模型（用于全局摘要生成）
  summaryBaseUrl: string;
  summaryApiKey: string;
  summaryModel: string;

  // 章节 Prompt（用户可自定义）
  prompts: Record<SectionTag, string>;

  // type → PDF++ 颜色 映射
  typeColorMap: Record<string, string>;

  // 是否使用颜色高亮（需 PDF++ 安装）
  useColorHighlights: boolean;

  // 并发 LLM 请求上限
  llmConcurrency: number; // 默认 3
}
```

### 3.1 HighlightResult.type 枚举与默认颜色映射

| type | 含义 | 默认颜色（PDF++）|
|------|------|----------------|
| `background` | 研究背景 | gray |
| `motivation` | 动机与痛点 | yellow |
| `contribution` | 核心贡献 | green |
| `limitation` | 前人方法局限 | red |
| `gap` | 研究空白 | red |
| `algorithm` | 算法逻辑 | blue |
| `formula` | 数学公式 | purple |
| `key_design` | 关键设计 | blue |
| `baseline` | 对比基准 | gray |
| `result` | 核心结果数据 | green |
| `ablation` | 消融实验结论 | orange |

---

## 4. 模块详细设计

### 4.1 Module A：ArXiv 客户端（arxiv-client.ts）

**职责**：从 ArXiv URL 提取 paper ID → 查询元数据 → 下载 PDF → 创建 Vault 文件

**核心流程**：
```typescript
// 1. 从 URL 提取 ArXiv ID（支持 abs/pdf/v1 等多种格式）
function extractArxivId(url: string): string

// 2. 查询元数据
async function fetchMetadata(id: string): Promise<ArxivMeta>
// GET https://export.arxiv.org/api/query?id_list={id}
// 解析 Atom XML：title, authors, abstract, published

// 3. 下载 PDF
async function downloadPdf(id: string, destPath: string): Promise<void>
// GET https://arxiv.org/pdf/{id}
// requestUrl({ url, method:'GET' }) → resp.arrayBuffer → vault.createBinary()

// 4. 创建主笔记
async function createNote(meta: ArxivMeta, pdfPath: string): Promise<TFile>
// YAML frontmatter + 摘要 + ![[paper.pdf]]
```

**错误处理**：
- 网络超时：requestUrl 默认超时，捕获后显示 `new Notice("Network error: ...")`
- 重复导入：检查附件路径是否已存在该 PDF，若是则询问是否覆盖
- ArXiv 限流：遇到 503 时 retry 1 次（延迟 3s）

---

### 4.2 Module B：PDF 解析与分块（pdf-parser.ts + section-chunker.ts）

**关键决策**：使用 `pdfjs-dist`（npm 安装）提取文本供 LLM 使用。注意：此处提取的 items 索引**不用于**生成 selection 锚点，仅用于文本分析。

**pdf-parser.ts 核心**：
```typescript
interface PageText {
  pageNum: number;
  items: Array<{ text: string; height: number; bold: boolean }>;
  fullText: string;
}
async function extractPages(pdfBytes: ArrayBuffer): Promise<PageText[]>
```

**section-chunker.ts 章节识别算法**：

启发式规则（按优先级）：
1. **关键词匹配**：正则 `/^\s*(abstract|introduction|related work|background|method|approach|experiment|evaluation|results|discussion|conclusion|references)\s*$/i`
2. **字体大小**：`item.height` 明显大于正文平均高度（> 1.5x）则视为标题
3. **全大写短文本**：长度 < 30 且全大写
4. **数字编号**：`/^\d+\.?\s+[A-Z]/` 模式

分块策略：
- 每个 Chunk 约 800 token（约 3200 字符），在段落边界切分
- 同一章节的连续文本合并为一个 Chunk
- 保留 `pageNum`（取 Chunk 起始页）和 `sectionTag`

**已知局限**：双栏 PDF 的文字流顺序可能乱序（pdf.js 按位置排序文本，双栏时可能混列）。这是已知问题，小模型对乱序有一定容忍度。

---

### 4.3 Module C：LLM 客户端（llm-client.ts + prompt-router.ts）

**llm-client.ts**：纯净的 `requestUrl` 封装，无第三方 SDK：

```typescript
async function callLlmForChunk(
  config: LlmConfig,
  systemPrompt: string,
  chunk: TextChunk
): Promise<HighlightResult[]> {
  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Section: ${chunk.sectionTag}\n\n${chunk.text}` }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 2048
  };
  const resp = await requestUrl({
    url: `${config.baseUrl}/chat/completions`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    throw: false  // 手动处理错误
  });
  if (resp.status !== 200) throw new Error(`LLM error ${resp.status}`);
  const json = resp.json as ChatCompletionResponse;
  const content = json.choices[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(content) as { highlights: HighlightResult[] };
  return (parsed.highlights ?? []).map(h => ({
    ...h,
    pageNum: chunk.pageNum,
    sectionTag: chunk.sectionTag
  }));
}
```

**并发控制**：使用 Promise 池模式限制同时发出的 LLM 请求数（默认 3 个并发）。

**prompt-router.ts — 4 种 System Prompt 默认模板**：

```
[Abstract + Introduction]
You are a research assistant. Extract key highlights as JSON.
RULE 1: "exact_text" MUST be copied verbatim from the input. Do not paraphrase.
RULE 2: If no relevant content found, return {"highlights": []}.
RULE 3: Never invent or hallucinate information.
Return JSON: {"highlights": [{"exact_text": "...", "type": "background|motivation|contribution"}]}
Focus: research background, problem statement, core contributions only.

[Related Work]
You are a research analyst. Extract prior work limitations as JSON.
RULE 1: "exact_text" must be direct quotes from the paper.
RULE 2: Output {"highlights": []} if nothing clearly fits.
Return JSON: {"highlights": [{"exact_text": "...", "type": "limitation|gap"}]}
Focus: what previous methods fail to do, what gaps remain.

[Method / Model]
You are a technical expert. Extract methodology highlights as JSON.
RULE 1: "exact_text" must be verbatim from the input.
RULE 2: For formulas, copy the plain text representation exactly.
RULE 3: Skip parameter derivations longer than 3 lines.
Return JSON: {"highlights": [{"exact_text": "...", "type": "algorithm|formula|key_design"}]}
Focus: algorithmic steps, key formulas, critical design choices.

[Experiment / Results]
You are a research evaluator. Extract quantitative results as JSON.
RULE 1: "exact_text" must be direct quotes. Numbers must be exact.
RULE 2: Return {"highlights": []} if no clear results found.
Return JSON: {"highlights": [{"exact_text": "...", "type": "baseline|result|ablation"}]}
Focus: comparison baselines, performance numbers, ablation findings.
```

**SectionTag → Prompt 路由完整映射表**：

| SectionTag | 路由到 |
|------------|--------|
| `abstract` | Abstract/Intro Prompt |
| `introduction` | Abstract/Intro Prompt |
| `related_work` | Related Work Prompt |
| `method` | Method Prompt |
| `experiment` | Experiment Prompt |
| `conclusion` | Abstract/Intro Prompt（重用；关注 contribution 类型） |
| `other` | 跳过 LLM 调用（不提取，直接忽略） |

---

### 4.4 Module D：PDF 锚点生成（pdf-anchor.ts + fuzzy-matcher.ts）

**核心挑战**：`selection=A,B,C,D` 的坐标必须来自 Obsidian 的定制 PDF.js（非 npm 标准版）。

**实现策略**：

```typescript
// 1. 在后台临时打开 PDF leaf（用户不可见）
// ⚠️ SPIKE TASK：Phase 3 开始时需要先调研访问路径
//   候选方案 A：app.embedRegistry.embedByExtension.get('pdf') 工厂方法
//   候选方案 B：通过 workspace.openLinkText 在临时 leaf 中加载 PDF，
//               访问 leaf.view.viewer.pdfViewer.pdfDocument
//   候选方案 C：参考 obsidian-pdf-evidence 插件源码确认最新 API
//   若所有路径均失败 → 返回 null，调用方使用页码级链接（降级路径 3）
async function loadPdfDocument(
  app: App, 
  pdfFile: TFile
): Promise<PDFDocumentProxy | null>

// 2. 提取 Obsidian 版 textContent items
async function getPageItems(
  doc: PDFDocumentProxy,
  pageNum: number
): Promise<TextItem[]>

// 3. 模糊匹配
function findBestMatch(
  needle: string,            // LLM 提取的 exact_text
  items: TextItem[],         // 某页的 items 数组
  threshold: number = 0.85   // 最低相似度
): MatchResult | null
// 实现：滑动窗口 + Levenshtein 距离

// 4. 生成链接
function buildPdfLink(
  pdfFileName: string,
  pageNum: number,
  match: MatchResult | null,
  type: string,
  settings: PaperAnalyzerSettings
): string
// match 存在 → [[file.pdf#page=X&selection=A,B,C,D]]
// 若 useColorHighlights && PDF++ 已安装 → 追加 &color={typeColorMap[type]}
// match 不存在 → [[file.pdf#page=X]]（降级到页码级）
```

**PDF++ 检测**：
```typescript
function hasPdfPlus(app: App): boolean {
  return !!(app as any).plugins?.plugins?.['obsidian-pdf-plus'];
}
```

**降级策略**（三层）：
1. ✅ 完整路径：selection 坐标 + PDF++ 颜色 → `[[file.pdf#page=1&selection=4,0,4,11&color=yellow]]`
2. 🟡 无颜色路径：selection 坐标但无 PDF++ → `[[file.pdf#page=1&selection=4,0,4,11]]`
3. 🟠 页码路径：坐标提取失败 → `[[file.pdf#page=1]]`

---

### 4.5 Module E：报告生成（report-writer.ts）

**追加写入策略**：
```typescript
async function appendReport(
  app: App,
  noteFile: TFile,
  anchors: PdfAnchor[]
): Promise<void> {
  const markdown = renderReport(anchors);
  await app.vault.adapter.append(noteFile.path, '\n\n' + markdown);
}
```

**Markdown 报告格式**：
```markdown
---

## AI 精读报告

### Abstract / Introduction

- **[motivation]** > "exact text from paper" → [[paper.pdf#page=1&selection=4,0,4,11&color=yellow]]
- **[contribution]** > "exact text" → [[paper.pdf#page=2&selection=1,0,2,5&color=green]]

### Method

- **[algorithm]** > "exact text" → [[paper.pdf#page=5&selection=...&color=blue]]
```

---

### 4.6 Module F：设置页面（settings.ts）

**UI 分区**（使用 Obsidian 原生 `Setting` 组件 + 自定义 HTML 分割线）：

1. **文件路径** — 附件文件夹路径、笔记文件夹路径
2. **提取模型** — Base URL、API Key（password 输入框）、Model 名称
3. **总结模型** — 同上（支持与提取模型相同）
4. **章节 Prompt** — 每种 SectionTag 一个 `TextArea`，支持恢复默认值
5. **高亮颜色映射** — Type → Color 下拉框（仅 PDF++ 用户可见）
6. **高级选项** — LLM 并发数（1-5）

---

## 5. 分阶段实现计划

### Phase 1（Module A + F + E + 骨架）
目标：能够通过 ArXiv URL 导入论文并创建笔记  
验证：插件加载 → 输入 URL → PDF 出现在 Vault → Markdown 笔记创建成功

### Phase 2（Module B + C）  
目标：LLM 能分析 PDF 并产出 JSON 高亮结果  
验证：Console 日志显示每个 Chunk 的提取结果；报告追加到笔记中（使用页码链接）

### Phase 3（Module D）
目标：生成精确的 PDF selection 锚点链接  
验证：点击报告中的链接 → Obsidian 跳转到 PDF 对应文本位置并高亮

---

## 6. 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| Obsidian 内置 PDF.js API 变更（如 v1.9 bug）| 中 | 高 | Phase 3 降级策略；监控版本更新 |
| 双栏 PDF 文字乱序 | 高 | 中 | 依赖 LLM 鲁棒性；在 prompt 中提示 |
| 小模型 JSON 格式错误 | 中 | 低 | try-catch JSON.parse + 跳过无效结果 |
| ArXiv 限流 | 低 | 低 | 单次导入无压力；批量导入加间隔 |
| `requestUrl` 超时（大 PDF） | 低 | 中 | 分块下载或提示用户 PDF 过大 |

---

## 7. 验证与测试方案

### Phase 1 验证
1. 构建插件：`npm run build`
2. 安装到测试 Vault
3. 在命令面板执行"Import ArXiv Paper"
4. 输入 `https://arxiv.org/abs/2303.08774`（GPT-4 论文）
5. 检查：Vault 内是否出现 PDF + Markdown 笔记

### Phase 2 验证
1. 在设置中填入 SiliconFlow API Key 和 Qwen 模型名
2. 对已导入的笔记重新触发 LLM 分析
3. 检查 Console：每个 Chunk 应打印 HighlightResult[]
4. 检查笔记底部：应追加 Markdown 报告（页码级链接）

### Phase 3 验证
1. 确保 PDF++ 已安装
2. 触发完整管道
3. 点击报告中的链接 → PDF 应跳转到对应文本并以颜色高亮

---

## 8. 外部参考

- [Obsidian PDF 深度链接语法（PDF++ 文档）](https://ryotaushio.github.io/obsidian-pdf-plus/backlink-highlighting-basics.html)
- [obsidian-pdf-evidence（Obsidian 内置 PDF.js 访问参考实现）](https://github.com/hi-jin/obsidian-pdf-evidence)
- [Obsidian requestUrl 文档与限制](https://forum.obsidian.md/t/make-http-requests-from-plugins/15461)
- [SiliconFlow API 文档](https://docs.siliconflow.com/en/api-reference/chat-completions/chat-completions)
- [Obsidian Vault API](https://docs.obsidian.md/Reference/TypeScript+API/Vault)
