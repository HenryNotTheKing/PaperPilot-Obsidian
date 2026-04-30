import { requestUrl, TFile } from "obsidian";
import type { App } from "obsidian";
import type { ArxivMeta } from "../types";

// --- Pure functions (unit tested) ---

export function extractArxivId(input: string): string | null {
	if (!input) return null;

	// New-format: 2303.08774 (4-digit year, 4-5 digit number), optional version
	const newFormat = /(?:arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,6})(?:v\d+)?/i;
	const newMatch = newFormat.exec(input);
	if (newMatch?.[1]) return newMatch[1];

	// Old-format URL: /abs/cs/0610101
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
	const publishedRaw =
		entry.querySelector("published")?.textContent?.trim() ?? "";
	const published = publishedRaw.slice(0, 10);

	const authors = Array.from(entry.querySelectorAll("author > name"))
		.map((el) => el.textContent?.trim() ?? "")
		.filter(Boolean);

	const rawId = entry.querySelector("id")?.textContent?.trim() ?? "";
	const id = extractArxivId(rawId) ?? rawId;

	const pdfLink = entry.querySelector('link[title="pdf"]');
	const pdfUrl = pdfLink?.getAttribute("href") ?? buildPdfUrl(id);

	return { id, title, authors, abstract, published, pdfUrl };
}

// --- Obsidian-dependent functions (manual integration tested) ---

export async function fetchArxivMeta(id: string): Promise<ArxivMeta> {
	const resp = await requestUrl({
		url: `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`,
		method: "GET",
		throw: false,
	});

	if (resp.status !== 200) {
		throw new Error(
			`ArXiv API returned ${resp.status}. Check your connection.`
		);
	}

	return parseArxivXml(resp.text);
}

export function sanitizeFileName(title: string): string {
	return title
		.replace(/[\\/:*?"<>|#\n\r]/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 100);
}

export function buildPdfFilePath(
	meta: Pick<ArxivMeta, "title">,
	attachmentFolder: string
): string {
	const folderPath = attachmentFolder.replace(/\/+$/, "");
	const safeTitle = sanitizeFileName(meta.title);
	return `${folderPath}/${safeTitle}.pdf`;
}

export function buildPaperNotePath(
	meta: Pick<ArxivMeta, "title">,
	notesFolder: string
): string {
	const folderPath = notesFolder.replace(/\/+$/, "");
	const safeTitle = sanitizeFileName(meta.title);
	return `${folderPath}/${safeTitle}.md`;
}

export const DEFAULT_PAPER_NOTE_TEMPLATE = 
`
---
arxiv_id: "{{arxiv_id}}"
title: "{{title_frontmatter}}"
published: "{{published}}"
pdf_file: "[[{{pdf_file}}]]"
tags:
  - summary
type:
  - paper
---
`;

export function renderPaperNoteTemplate(
	template: string,
	meta: ArxivMeta,
	pdfFile: Pick<TFile, "name">
): string {
	const authorsYaml = meta.authors
		.map((a) => `  - "${a.replace(/"/g, "'")}"`)
		.join("\n");
	const abstractFormatted = meta.abstract.replace(/\n+/g, " ").trim();
	const titleForFrontmatter = meta.title.replace(/"/g, "'");

	const replacements: Record<string, string> = {
		arxiv_id: meta.id,
		title: meta.title,
		title_frontmatter: titleForFrontmatter,
		authors_yaml: authorsYaml,
		published: meta.published,
		abstract: abstractFormatted,
		pdf_file: pdfFile.name,
	};

	return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
		return replacements[key] ?? match;
	});
}

export function buildPaperNoteContent(
	meta: ArxivMeta,
	pdfFile: Pick<TFile, "name">,
	noteTemplate: string = DEFAULT_PAPER_NOTE_TEMPLATE
): string {
	const effectiveTemplate = noteTemplate.trim() || DEFAULT_PAPER_NOTE_TEMPLATE;
	return renderPaperNoteTemplate(effectiveTemplate, meta, pdfFile);
}

export function findExistingPdfFile(
	app: App,
	meta: ArxivMeta,
	attachmentFolder: string
): TFile | null {
	const existing = app.vault.getAbstractFileByPath(
		buildPdfFilePath(meta, attachmentFolder)
	);
	return existing instanceof TFile ? existing : null;
}

export function findExistingPaperNote(
	app: App,
	meta: ArxivMeta,
	notesFolder: string
): TFile | null {
	const existing = app.vault.getAbstractFileByPath(
		buildPaperNotePath(meta, notesFolder)
	);
	return existing instanceof TFile ? existing : null;
}

export async function downloadPdf(
	app: App,
	meta: ArxivMeta,
	attachmentFolder: string,
	options?: { overwrite?: boolean }
): Promise<TFile> {
	const folderPath = attachmentFolder.replace(/\/+$/, "");

	if (!app.vault.getAbstractFileByPath(folderPath)) {
		await app.vault.createFolder(folderPath);
	}

	const filePath = buildPdfFilePath(meta, attachmentFolder);

	const existing = app.vault.getAbstractFileByPath(filePath);
	if (existing instanceof TFile && !options?.overwrite) return existing;

	const resp = await requestUrl({
		url: meta.pdfUrl,
		method: "GET",
		throw: false,
	});

	if (resp.status !== 200) {
		throw new Error(
			`PDF download failed (HTTP ${resp.status}). Try opening the URL in a browser.`
		);
	}

	if (existing instanceof TFile) {
		await app.vault.modifyBinary(existing, resp.arrayBuffer);
		return existing;
	}

	try {
		return await app.vault.createBinary(filePath, resp.arrayBuffer);
	} catch (error) {
		const racedExisting = app.vault.getAbstractFileByPath(filePath);
		if (racedExisting instanceof TFile) {
			if (options?.overwrite) {
				await app.vault.modifyBinary(racedExisting, resp.arrayBuffer);
			}
			return racedExisting;
		}

		throw error;
	}
}

export async function createPaperNote(
	app: App,
	meta: ArxivMeta,
	pdfFile: TFile,
	notesFolder: string,
	options?: { overwrite?: boolean; noteTemplate?: string }
): Promise<TFile> {
	const folderPath = notesFolder.replace(/\/+$/, "");

	if (!app.vault.getAbstractFileByPath(folderPath)) {
		await app.vault.createFolder(folderPath);
	}

	const notePath = buildPaperNotePath(meta, notesFolder);
	const existing = app.vault.getAbstractFileByPath(notePath);
	if (existing instanceof TFile && !options?.overwrite) return existing;

	const content = buildPaperNoteContent(
		meta,
		pdfFile,
		options?.noteTemplate
	);

	if (existing instanceof TFile) {
		await app.vault.modify(existing, content);
		return existing;
	}

	try {
		return await app.vault.create(notePath, content);
	} catch (error) {
		const racedExisting = app.vault.getAbstractFileByPath(notePath);
		if (racedExisting instanceof TFile) {
			if (options?.overwrite) {
				await app.vault.modify(racedExisting, content);
			}
			return racedExisting;
		}

		throw error;
	}
}
