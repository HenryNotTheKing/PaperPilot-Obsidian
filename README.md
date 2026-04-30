<div align="center">

# Paper Pilot

**Your Obsidian co-pilot for navigating dense academic literature.**

Import arXiv papers, extract AI-powered highlights, and trace every insight back to the source PDF — all without leaving your vault.

[中文说明](README.zh-CN.md)

[![Obsidian](https://img.shields.io/badge/Obsidian-1.4.0+-7c3aed?logo=obsidian&logoColor=white)](https://obsidian.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](tsconfig.json)
[![Desktop only](https://img.shields.io/badge/platform-desktop-orange)](manifest.json)

</div>

---

## Why "Paper Pilot"?

Academic papers are dense skies. Reading one paper means navigating dozens of pages, hundreds of citations, and multiple technical threads — all at once.

**Paper Pilot** is your co-pilot for that journey.

Just as a flight co-pilot handles the instruments so the captain can focus on judgment, Paper Pilot handles the mechanics of reading: importing PDFs, chunking sections, extracting key claims, painting them back onto the page with color-coded highlights, and surfacing related papers from your vault or the web.

You stay in command. The plugin does the navigation.

The name also nods to the *pilot study* — that first exploratory pass through a new research area. Paper Pilot is designed precisely for that moment: when you are parachuting into an unfamiliar field and need to get your bearings fast.

---

## What Paper Pilot does

Paper Pilot is a desktop Obsidian plugin for researchers who want more than a generic AI summary.

It imports arXiv papers into your vault, runs section-level LLM analysis, paints evidence back onto the PDF with color-coded highlights, and keeps your notes connected to the exact page that supports each claim.

---

## Features

| Feature | Detail |
|---|---|
| **arXiv import** | One click to fetch PDF, metadata, and create a linked note |
| **Section-level AI extraction** | Motivation, key steps, and contributions extracted per section |
| **Color-coded PDF highlights** | Highlights painted directly onto the PDF, color-mapped by category |
| **Four summary modes** | Low / Medium / High / Extreme — trade speed for depth |
| **Citation sidebar** | Cited and citing paper retrieval; vault similarity matching |
| **Background queues** | Analysis and summary jobs run without blocking the UI |
| **Bilingual UI** | English and Simplified Chinese |
| **Theme compatible** | Works with any Obsidian theme, light or dark |

---

## Screenshots

### Settings tab

![Settings](screenshots/cn-01-settings.png)

### Import modal

![Import modal](screenshots/cn-02-import-modal.png)

### Summary modal

![Summary modal](screenshots/cn-03-summary-modal.png)

### PDF highlights + Citation sidebar

![PDF highlights](screenshots/05-pdf-highlights.png)

### Theme compatibility

Paper Pilot adapts to any Obsidian theme. Highlight colors and sidebar appearance follow your vault's color scheme, and every color is individually configurable in settings.

![Works with other themes](screenshots/otherTheme.png)

---

## Installation

Paper Pilot is desktop-only.

### Manual install

1. Download `main.js`, `manifest.json`, `styles.css`, and `pdf.worker.min.mjs` from the [release page](https://github.com/HenryNotTheKing/PaperPilot-Obsidian/releases/latest).
2. Create the folder `.obsidian/plugins/PaperPilot/` inside your vault and put the files there.
3. Open **Settings → Community plugins** in Obsidian and enable **Paper Pilot**.

> **Migrating from an older build?**
> If you installed a previous build under `.obsidian/plugins/ai-paper-analyzer/`, move all files to `.obsidian/plugins/PaperPilot/` and reload Obsidian.

### Build from source

```bash
git clone https://github.com/HenryNotTheKing/PaperPilot-Obsidian.git
cd PaperPilot-Obsidian
npm install
npm run build
```

Copy the built `main.js`, `manifest.json`, `styles.css`, and `pdf.worker.min.mjs` into `.obsidian/plugins/PaperPilot/`.

---

## Configuration

Open **Settings → Community plugins → Paper Pilot**.

### Required

| Setting | Description |
|---|---|
| Extraction model | LLM endpoint and model name used for section-level extraction |
| Summary model | LLM endpoint and model name used for summary generation |

### Optional

| Setting | Description |
|---|---|
| Language | UI language (English / Simplified Chinese) |
| File paths | Where PDFs and notes are saved in your vault |
| Duplicate handling | What to do when a paper is already in your vault |
| Paper note template | Custom frontmatter and body template for new notes |
| Hugging Face paper markdown | Additional metadata fields from Hugging Face Papers |
| Highlight colors & opacity | Per-category colors (motivation, method, result, …) and overlay transparency |
| LLM concurrency | How many parallel LLM requests to allow |
| Citation sidebar | Depth, source, and display options |

---

## Privacy

Paper Pilot does not include telemetry. PDFs are parsed locally with `pdfjs-dist`, and only the extracted text chunks you choose to process are sent to your configured LLM endpoint. No data is sent anywhere else.

---

## Development

```bash
npm install       # install dependencies
npm run dev       # watch mode (fast rebuild)
npm run build     # production build (type-check + minify)
npm run lint      # ESLint with typescript-eslint
npm run test      # Vitest unit tests
```

---

## License

[MIT](LICENSE) © HenryNotTheKing