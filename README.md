<div align="center">

# Paper Pilot

An Obsidian co-pilot for importing arXiv papers, extracting AI-powered highlights, and tracing every insight back to the source PDF.

[中文说明](README.zh-CN.md)

[![Obsidian](https://img.shields.io/badge/Obsidian-1.4.0+-7c3aed?logo=obsidian&logoColor=white)](https://obsidian.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](tsconfig.json)
[![Desktop only](https://img.shields.io/badge/platform-desktop-orange)](manifest.json)

</div>

## Overview

Paper Pilot is a desktop Obsidian plugin for researchers who want more than a generic AI summary.

It imports arXiv papers into your vault, runs section-level LLM analysis, paints evidence back onto the PDF with color-coded highlights, and keeps your notes connected to the exact page that supports each claim.

## Features

- One-click arXiv import for PDF, metadata, and note creation.
- Section-level AI extraction for motivation, key steps, and contributions.
- Low / Medium / High / Extreme summary modes.
- Citation sidebar with cited / citing retrieval and vault similarity matching.
- Background queues for analysis and summary jobs.
- Bilingual UI with English and Simplified Chinese.

## Screenshots

The repository currently maintains the polished Chinese UI screenshot set, and both README versions use it.

### Settings

![Chinese settings screenshot](screenshots/cn-01-settings.png)

### Import modal

![Chinese import modal screenshot](screenshots/cn-02-import-modal.png)

### Summary modal

![Chinese summary modal screenshot](screenshots/cn-03-summary-modal.png)

### PDF highlights

![PDF highlight screenshot](screenshots/05-pdf-highlights.png)

## Installation

Paper Pilot is desktop-only.

### Manual install

1. Download `main.js`, `manifest.json`, `styles.css`, and `pdf.worker.min.mjs` from the release page.
2. Put them into `.obsidian/plugins/PaperPilot/` inside your vault.
3. Open `Settings -> Community plugins` in Obsidian and enable Paper Pilot.

Note: this release changes the plugin ID to `PaperPilot`. If you installed an older build under `.obsidian/plugins/ai-paper-analyzer/`, move or reinstall the plugin into `.obsidian/plugins/PaperPilot/`.

### Build from source

```bash
git clone https://github.com/HenryNotTheKing/PaperPilot-Obsidian.git
cd PaperPilot-Obsidian
npm install
npm run build
```

Copy the built `main.js`, `manifest.json`, `styles.css`, and `pdf.worker.min.mjs` into `.obsidian/plugins/PaperPilot/`.

## Configuration

Open `Settings -> Community plugins -> Paper Pilot`.

Minimum setup:

- Extraction model
- Summary model

Useful settings:

- Language
- File paths
- Duplicate handling
- Paper note template
- Hugging Face paper markdown
- Highlight colors and opacity
- LLM concurrency
- Citation sidebar options

## Privacy

Paper Pilot does not include telemetry. PDFs are parsed locally, and only the extracted text chunks you choose to process are sent to your configured LLM endpoint.

## Development

```bash
npm install
npm run dev
npm run build
npm run lint
npm run test
```

## License

[MIT](LICENSE) © HenryNotTheKing