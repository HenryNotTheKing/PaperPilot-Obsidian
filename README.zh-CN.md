<div align="center">

# Paper Pilot

**你的 Obsidian 论文副驾，带你穿越学术文献的密林。**

一键导入 arXiv 论文，AI 按章节提取关键内容，高亮回写 PDF，笔记直通原始页面。

[English](README.md)

[![Obsidian](https://img.shields.io/badge/Obsidian-1.4.0+-7c3aed?logo=obsidian&logoColor=white)](https://obsidian.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](tsconfig.json)
[![Desktop only](https://img.shields.io/badge/platform-desktop-orange)](manifest.json)

</div>

---

## 安装

Paper Pilot 仅支持桌面端，且需要你自己提供 **兼容 OpenAI 接口的 LLM API**（如 OpenAI、DeepSeek、Qwen、本地 Ollama 等）。安装完成后前往 [配置](#配置) 填写接口信息。

### 手动安装

1. 从 [最新 Release 页面](https://github.com/HenryNotTheKing/PaperPilot-Obsidian/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`、`pdf.worker.min.mjs`。
2. 在你的库目录新建文件夹 `.obsidian/plugins/PaperPilot/`，将文件放入其中。
3. 在 Obsidian 中打开 **设置 → 第三方插件**，启用 **Paper Pilot**。
4. 进入 **设置 → 第三方插件 → Paper Pilot**，填写你的 LLM 接口地址和模型名称。

> **从旧版迁移？**
> 如果你之前把旧版本安装在 `.obsidian/plugins/ai-paper-analyzer/`，需要把文件移动到 `.obsidian/plugins/PaperPilot/` 并重新加载 Obsidian。

### 从源码构建

```bash
git clone https://github.com/HenryNotTheKing/PaperPilot-Obsidian.git
cd PaperPilot-Obsidian
npm install
npm run build
```

构建完成后，把 `main.js`、`manifest.json`、`styles.css`、`pdf.worker.min.mjs` 复制到 `.obsidian/plugins/PaperPilot/`。

---

## 为什么叫 Paper Pilot？

学术论文是一片密集的天空——几十页正文、上百条引用、多条交织的技术线索同时压来。

**Paper Pilot** 是你的副驾驶（co-pilot）：它负责仪表盘的操作（导入、拆解、提取、高亮），让你专注于判断和思考。就像 *pilot study*，它是你进入陌生领域时的第一次探索性飞行。

---

## 功能

| 功能 | 说明 |
|---|---|
| **arXiv 一键导入** | 自动下载 PDF、抓取元数据、生成关联笔记 |
| **章节级 AI 提取** | 按章节提取动机、关键步骤、贡献 |
| **分类 PDF 高亮** | 结果直接高亮回写到 PDF，颜色按类别区分 |
| **四档摘要模式** | Low / Medium / High / Extreme，速度与深度自由权衡 |
| **引用侧栏** | 抓取被引/引用论文，与库内笔记做相似度匹配 |
| **引用导出** | 支持从当前笔记或按 Tag 批量导出引用，格式支持 BibTeX、IEEE 和自定义模板 |
| **后台队列** | 分析和摘要任务支持后台执行，不阻塞界面操作 |
| **中英文双语** | 支持英文和简体中文界面 |
| **兼容各类主题** | 适配任意 Obsidian 主题，深色浅色均可 |

---

## 截图

### 设置页

![设置页](screenshots/cn-01-settings.png)

### 导入弹窗

![导入弹窗](screenshots/cn-02-import-modal.png)

### 摘要弹窗

![摘要弹窗](screenshots/cn-03-summary-modal.png)

### PDF 高亮 + 引用侧栏

![PDF 高亮效果](screenshots/cn-05-pdf-highlights.png)

### 主题兼容性

Paper Pilot 适配任意 Obsidian 主题。高亮颜色和侧栏外观会跟随你的库配色自适应，每种颜色均可在设置中单独调整。

![其他主题下的效果](screenshots/otherTheme.png)

---

## 配置

打开 **设置 → 第三方插件 → Paper Pilot**。

### LLM 接口（必填）

| 配置项 | 说明 |
|---|---|
| **Extraction model** | 用于章节级高亮提取的 OpenAI 兼容接口 URL + 模型名 |
| **Summary model** | 用于摘要生成的 OpenAI 兼容接口 URL + 模型名 |
| **API key** | 上述接口的 Bearer Token（两个接口可共用同一个 key） |

OpenAI、DeepSeek、Qwen、本地 Ollama 等兼容 OpenAI 接口的服务均可使用。

### 摘要等级说明

生成摘要时可选择四个等级，决定深度、语气与底层流水线：

| 等级 | 流水线 | 输出风格 |
|---|---|---|
| **Low** | 单次 LLM 调用 | 几百字概览：问题、主要贡献、研究方法简述。用于快速分流。 |
| **Medium** | 单次 LLM 调用 | 全文总结，按章节分点。简洁实用，不展开术语，适合"已经读过"的论文复习。 |
| **High** | 多阶段智能体（规划 → 章节解读 → 公式展开 → 合并） | 严谨学术化全文综述：原文图片、关键公式插入到位，所有术语都给出定义；末尾还会附一节 **推荐阅读**，从引用与被引用中挑出 5 篇相关论文。 |
| **Extreme** | 多阶段智能体（结构同 High） | 博客式娓娓道来，把读者当作刚进入这个领域的研究生：每个技术细节、动机、设计选择都耐心展开，纯白话讲透。 |

输出长度由提示词软约束控制，不再使用硬上限截断，模型会根据论文复杂度自行调节篇幅。所有多阶段任务的并发度统一由 **LLM concurrency** 这一项设置决定。

**建议**：初读用 **Medium**；需要方法严谨度用 **High**；想要直觉与零基础友好讲解用 **Extreme**；只需快速分流用 **Low**。

### 其他配置项

| 配置项 | 说明 |
|---|---|
| Language | 界面语言（英文 / 简体中文） |
| File paths | PDF 和笔记在库中的保存路径 |
| Duplicate handling | 论文已存在于库中时的处理方式 |
| Paper note template | 新笔记的自定义模板（frontmatter 与正文） |
| Hugging Face paper markdown | 从 Hugging Face Papers 获取的额外元数据字段 |
| Highlight colors | 各类别的高亮颜色：动机、方法、结果、背景、其他 |
| Highlight opacity | 高亮覆盖层的透明度（0.15 – 1.0） |
| LLM concurrency | 允许同时发送的 LLM 请求数 |
| Citation sidebar | 引用侧栏的深度、来源与显示选项 |
| Citation export | 默认导出格式，以及可复用的自定义引用模板 |

---

## 隐私

Paper Pilot 不包含遥测。PDF 在本地由 `pdfjs-dist` 解析，只有你选择交给模型处理的文本片段会发送到你配置的 LLM 接口，不会向其他任何地方发送数据。

---

## 开发

```bash
npm install       # 安装依赖
npm run dev       # 监听模式（快速重构建）
npm run build     # 生产构建（类型检查 + 压缩）
npm run lint      # ESLint + typescript-eslint
npm run test      # Vitest 单元测试
```

---

## 许可证

[MIT](LICENSE) © HenryNotTheKing