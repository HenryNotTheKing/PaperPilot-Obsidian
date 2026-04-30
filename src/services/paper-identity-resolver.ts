import type { App, TFile } from "obsidian";
import {
	DEFAULT_ARXIV_FIELD_ALIASES,
	DEFAULT_DOI_FIELD_ALIASES,
	type CitationSidebarSettings,
	type PaperIdType,
} from "../types";
import { extractArxivId } from "./arxiv-client";
import { parsePdf } from "./pdf-parser";

type Frontmatter = Record<string, unknown>;

export interface PaperIdentity {
	id: string;
	type: PaperIdType;
	matchedField?: string;
}

export interface ResolvedPaperContext {
	paperId: PaperIdentity;
	queryText: string;
	resolutionSource: "frontmatter" | "note-body" | "linked-note" | "pdf-text";
	relatedNote: TFile | null;
}

export interface PaperIdentityResolverOptions {
	notesFolderPath: string;
	citationSidebar: CitationSidebarSettings;
}

const DOI_URL_RE = /https?:\/\/(?:dx\.)?doi\.org\/([^\s<>"']+)/i;
const DOI_LABELED_RE = /\bdoi\b\s*[:=]?\s*(10\.\d{4,9}\/[^\s<>"']+)/i;
const DOI_BARE_RE = /\b(10\.\d{4,9}\/[^\s<>"']+)/i;
const ARXIV_URL_RE = /arxiv\.org\/(?:abs|pdf)\/([\w-]+\/\d+|\d{4}\.\d{4,6})/i;
const ARXIV_LABELED_RE = /\barxiv\b\s*[:=]?\s*([\w-]+\/\d+|\d{4}\.\d{4,6})/i;
const NOTE_BODY_SCAN_LIMIT = 8000;
const PDF_PREVIEW_PAGE_LIMIT = 3;
const PDF_PREVIEW_CHAR_LIMIT = 1200;

export function isCitationGraphFile(file: TFile | null): file is TFile {
	return !!file && (file.extension === "md" || file.extension === "pdf");
}

export function extractDoi(input: string): string | null {
	if (!input) return null;

	const urlMatch = DOI_URL_RE.exec(input);
	if (urlMatch?.[1]) return cleanDoi(urlMatch[1]);

	const labeledMatch = DOI_LABELED_RE.exec(input);
	if (labeledMatch?.[1]) return cleanDoi(labeledMatch[1]);

	const bareMatch = DOI_BARE_RE.exec(input);
	if (bareMatch?.[1]) return cleanDoi(bareMatch[1]);

	return null;
}

export async function resolvePaperContext(
	app: App,
	file: TFile,
	options: PaperIdentityResolverOptions
): Promise<ResolvedPaperContext | null> {
	if (file.extension === "md") {
		return resolveMarkdownPaperContext(app, file, options);
	}

	if (file.extension === "pdf") {
		return resolvePdfPaperContext(app, file, options);
	}

	return null;
}

async function resolveMarkdownPaperContext(
	app: App,
	file: TFile,
	options: PaperIdentityResolverOptions
): Promise<ResolvedPaperContext | null> {
	const frontmatter = getFrontmatter(app, file);
	const frontmatterMatch = resolveFromFrontmatter(
		frontmatter,
		options.citationSidebar
	);
	const queryText = buildMarkdownQueryText(file, frontmatter);

	if (frontmatterMatch) {
		return {
			paperId: frontmatterMatch,
			queryText,
			resolutionSource: "frontmatter",
			relatedNote: file,
		};
	}

	try {
		const body = await app.vault.read(file);
		const bodyMatch = extractPaperIdentity(body.slice(0, NOTE_BODY_SCAN_LIMIT));
		if (!bodyMatch) return null;

		return {
			paperId: bodyMatch,
			queryText,
			resolutionSource: "note-body",
			relatedNote: file,
		};
	} catch {
		return null;
	}
}

async function resolvePdfPaperContext(
	app: App,
	pdfFile: TFile,
	options: PaperIdentityResolverOptions
): Promise<ResolvedPaperContext | null> {
	const linkedNote = findAssociatedNoteForPdf(app, pdfFile, options.notesFolderPath);
	let linkedNoteQueryText = "";

	if (linkedNote) {
		const linkedContext = await resolveMarkdownPaperContext(app, linkedNote, options);
		if (linkedContext) {
			return {
				paperId: linkedContext.paperId,
				queryText: linkedContext.queryText,
				resolutionSource: "linked-note",
				relatedNote: linkedNote,
			};
		}

		linkedNoteQueryText = buildMarkdownQueryText(
			linkedNote,
			getFrontmatter(app, linkedNote)
		);
	}

	try {
		const pages = await parsePdf(app, pdfFile);
		const previewText = pages
			.slice(0, PDF_PREVIEW_PAGE_LIMIT)
			.map((page) => page.fullText)
			.join("\n");
		const paperId = extractPaperIdentity(previewText);
		if (!paperId) return null;

		return {
			paperId,
			queryText: linkedNoteQueryText || buildPdfQueryText(pdfFile, previewText),
			resolutionSource: "pdf-text",
			relatedNote: linkedNote ?? null,
		};
	} catch {
		return null;
	}
}

function resolveFromFrontmatter(
	frontmatter: Frontmatter | undefined,
	settings: CitationSidebarSettings
): PaperIdentity | null {
	if (!frontmatter) return null;

	const lookup = buildFrontmatterLookup(frontmatter);
	const arxivAliases =
		settings.arxivFieldAliases.length > 0
			? settings.arxivFieldAliases
			: DEFAULT_ARXIV_FIELD_ALIASES;
	const doiAliases =
		settings.doiFieldAliases.length > 0
			? settings.doiFieldAliases
			: DEFAULT_DOI_FIELD_ALIASES;

	for (const alias of arxivAliases) {
		const entry = lookup.get(alias.toLowerCase());
		const value = coerceText(entry?.value);
		const arxivId = value ? extractArxivId(value) : null;
		if (arxivId) {
			return { id: arxivId, type: "arxiv", matchedField: entry?.key };
		}
	}

	for (const alias of doiAliases) {
		const entry = lookup.get(alias.toLowerCase());
		const value = coerceText(entry?.value);
		const doi = value ? extractDoi(value) : null;
		if (doi) {
			return { id: doi, type: "doi", matchedField: entry?.key };
		}
	}

	const sourceValue = coerceText(lookup.get("source")?.value);
	if (sourceValue) {
		const sourceArxiv = extractArxivId(sourceValue);
		if (sourceArxiv) return { id: sourceArxiv, type: "arxiv", matchedField: "source" };
		const sourceDoi = extractDoi(sourceValue);
		if (sourceDoi) return { id: sourceDoi, type: "doi", matchedField: "source" };
	}

	return null;
}

function extractPaperIdentity(text: string): PaperIdentity | null {
	const explicitArxivId = extractExplicitArxivId(text);
	if (explicitArxivId) return { id: explicitArxivId, type: "arxiv" };

	const doi = extractDoi(text);
	if (doi) return { id: doi, type: "doi" };

	const arxivId = extractArxivId(text);
	if (arxivId) return { id: arxivId, type: "arxiv" };

	return null;
}

function buildMarkdownQueryText(file: TFile, frontmatter: Frontmatter | undefined): string {
	const lookup = buildFrontmatterLookup(frontmatter);
	return [
		file.basename,
		coerceText(lookup.get("title")?.value) ?? "",
		coerceText(lookup.get("abstract")?.value) ?? "",
	]
		.filter(Boolean)
		.join(" ")
		.trim();
}

function buildPdfQueryText(file: TFile, previewText: string): string {
	const collapsedPreview = previewText.replace(/\s+/g, " ").trim();
	return [file.basename, collapsedPreview.slice(0, PDF_PREVIEW_CHAR_LIMIT)]
		.filter(Boolean)
		.join(" ")
		.trim();
}

function findAssociatedNoteForPdf(
	app: App,
	pdfFile: TFile,
	notesFolderPath: string
): TFile | null {
	const markdownFiles = app.vault
		.getMarkdownFiles()
		.filter((file) => isPathWithinFolder(file.path, notesFolderPath));
	const normalizedPdfTitle = normalizeTitle(pdfFile.basename);

	const exactPathMatches: TFile[] = [];
	const exactNameMatches: TFile[] = [];
	const sourceMatches: TFile[] = [];
	const basenameMatches: TFile[] = [];
	const titleMatches: TFile[] = [];

	for (const note of markdownFiles) {
		const frontmatter = getFrontmatter(app, note);
		const lookup = buildFrontmatterLookup(frontmatter);
		const pdfField = coerceText(lookup.get("pdf_file")?.value);
		if (pdfField) {
			if (matchesPdfPath(pdfField, pdfFile.path)) exactPathMatches.push(note);
			if (matchesPdfName(pdfField, pdfFile.name)) exactNameMatches.push(note);
		}

		const sourceField = coerceText(lookup.get("source")?.value);
		if (sourceField && matchesPdfReference(sourceField, pdfFile)) {
			sourceMatches.push(note);
		}

		if (normalizeTitle(note.basename) === normalizedPdfTitle) {
			basenameMatches.push(note);
		}

		const titleField = coerceText(lookup.get("title")?.value);
		if (titleField && normalizeTitle(titleField) === normalizedPdfTitle) {
			titleMatches.push(note);
		}
	}

	return (
		pickUniqueMatch(exactPathMatches) ??
		pickUniqueMatch(exactNameMatches) ??
		pickUniqueMatch(sourceMatches) ??
		pickUniqueMatch(basenameMatches) ??
		pickUniqueMatch(titleMatches) ??
		null
	);
}

function getFrontmatter(app: App, file: TFile): Frontmatter | undefined {
	const cache = app.metadataCache.getFileCache(file);
	const frontmatter = cache?.frontmatter as Frontmatter | undefined;
	return frontmatter;
}

function buildFrontmatterLookup(frontmatter: Frontmatter | undefined): Map<string, { key: string; value: unknown }> {
	const lookup = new Map<string, { key: string; value: unknown }>();
	if (!frontmatter) return lookup;

	for (const [key, value] of Object.entries(frontmatter)) {
		lookup.set(key.toLowerCase(), { key, value });
	}

	return lookup;
}

function coerceText(value: unknown): string | null {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed || null;
	}

	if (Array.isArray(value)) {
		const joined = value
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim())
			.filter(Boolean)
			.join(" ");
		return joined || null;
	}

	return null;
}

function extractExplicitArxivId(text: string): string | null {
	const urlMatch = ARXIV_URL_RE.exec(text);
	if (urlMatch?.[1]) return extractArxivId(urlMatch[1]);

	const labeledMatch = ARXIV_LABELED_RE.exec(text);
	if (labeledMatch?.[1]) return extractArxivId(labeledMatch[1]);

	return null;
}

function cleanDoi(doi: string): string {
	return doi.trim().replace(/[.,;]+$/, "");
}

function normalizeTitle(value: string): string {
	return value
		.toLowerCase()
		.replace(/[_-]+/g, " ")
		.replace(/[^a-z0-9\s]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeVaultPath(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function isPathWithinFolder(path: string, folderPath: string): boolean {
	const normalizedPath = normalizeVaultPath(path).toLowerCase();
	const normalizedFolder = normalizeVaultPath(folderPath).toLowerCase();
	if (!normalizedFolder) return true;
	return (
		normalizedPath === normalizedFolder ||
		normalizedPath.startsWith(`${normalizedFolder}/`)
	);
}

function matchesPdfPath(value: string, pdfPath: string): boolean {
	const normalizedValue = normalizeVaultPath(stripWikiLink(value)).toLowerCase();
	const normalizedPdfPath = normalizeVaultPath(pdfPath).toLowerCase();
	return normalizedValue === normalizedPdfPath;
}

function matchesPdfName(value: string, pdfName: string): boolean {
	return stripWikiLink(value).trim().toLowerCase() === pdfName.toLowerCase();
}

function matchesPdfReference(value: string, pdfFile: TFile): boolean {
	const normalizedValue = value.toLowerCase();
	const pdfPath = normalizeVaultPath(pdfFile.path).toLowerCase();
	const pdfName = pdfFile.name.toLowerCase();
	return (
		matchesPdfPath(value, pdfFile.path) ||
		matchesPdfName(value, pdfFile.name) ||
		normalizedValue.includes(`[[${pdfName}]]`) ||
		normalizedValue.includes(pdfPath)
	);
}

function stripWikiLink(value: string): string {
	return value.replace(/^!?\[\[/, "").replace(/\]\]$/, "");
}

function pickUniqueMatch(matches: TFile[]): TFile | undefined {
	const uniqueMatches = Array.from(new Map(matches.map((file) => [file.path, file])).values());
	return uniqueMatches.length === 1 ? uniqueMatches[0] : undefined;
}