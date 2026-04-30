import { requestUrl, type App, type TFile } from "obsidian";
import type { PaperAnalyzerSettings } from "../settings";
import type {
	HighEffortSourceAttempt,
	HighEffortSourceBundle,
	HighEffortSourceKind,
} from "../types";
import { indexMarkdownContentPointers } from "./markdown-section-chunker";
import {
	sanitizeMarkdownForObsidian,
	sanitizeMathForObsidian,
} from "./obsidian-markdown-utils";
import { parsePdf, type PageData } from "./pdf-parser";
import { chunkPages } from "./section-chunker";

const HUGGING_FACE_PAPERS_BASE_URL = "https://huggingface.co";
const ARXIV_HTML_BASE_URL = "https://arxiv.org";
const AR5IV_BASE_URL = "https://ar5iv.labs.arxiv.org";
const JINA_READER_BASE_URL = "https://r.jina.ai/http://arxiv.org";

interface HighEffortSourceBundleOptions {
	app: App;
	pdfFile: TFile;
	paperTitle: string;
	arxivId?: string | null;
	settings: Pick<
		PaperAnalyzerSettings,
		"huggingFaceApiKey" | "preferHuggingFacePaperMarkdown"
	>;
}

interface SourceFetchResult {
	kind: HighEffortSourceKind;
	label: string;
	markdown: string;
}

export function buildHuggingFacePaperMarkdownUrl(arxivId: string): string {
	return `${HUGGING_FACE_PAPERS_BASE_URL}/papers/${encodeURIComponent(arxivId)}.md`;
}

export function buildArxivHtmlUrl(arxivId: string): string {
	return `${ARXIV_HTML_BASE_URL}/html/${encodeURIComponent(arxivId)}`;
}

export function buildAr5ivUrl(arxivId: string): string {
	return `${AR5IV_BASE_URL}/html/${encodeURIComponent(arxivId)}`;
}

export function buildJinaReaderUrl(arxivId: string): string {
	return `${JINA_READER_BASE_URL}/html/${encodeURIComponent(arxivId)}`;
}

export function truncateHuggingFacePaperMarkdown(markdown: string): string {
	const normalized = markdown.replace(/\r\n?/g, "\n").trim();
	if (!normalized) return "";

	// Soft-limit policy: do not truncate the input. Just normalize whitespace
	// and strip raw image markdown that the plain summary path cannot use.
	return normalized
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export async function fetchPaperMarkdownFromHuggingFace(
	arxivId: string,
	settings: Pick<PaperAnalyzerSettings, "huggingFaceApiKey">
): Promise<string | null> {
	const apiKey = settings.huggingFaceApiKey.trim();
	const headers: Record<string, string> = {
		Accept: "text/markdown",
	};
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}

	const response = await requestUrl({
		url: buildHuggingFacePaperMarkdownUrl(arxivId),
		method: "GET",
		headers,
		throw: false,
	});

	if (response.status === 404) {
		return null;
	}

	if (response.status !== 200) {
		throw new Error(
			`Hugging Face paper markdown returned ${response.status}: ${response.text.slice(0, 200)}`
		);
	}

	return response.text.trim() || null;
}

function buildPdfMarkdownSource(paperTitle: string, pages: PageData[]): string {
	const chunks = chunkPages(pages);
	if (chunks.length === 0) {
		const pageContent = pages
			.map((page) => `## Page ${page.pageNum}\n${page.fullText.trim()}`)
			.filter((entry) => !/^## Page \d+\s*$/.test(entry))
			.join("\n\n");
		return sanitizeMarkdownForObsidian(
			[`# ${paperTitle}`, pageContent].filter(Boolean).join("\n\n").trim()
		);
	}

	const body = chunks
		.map((chunk) => {
			const label = chunk.headingText || chunk.sectionTag;
			return [`## ${label}`, chunk.text.trim()].join("\n");
		})
		.join("\n\n");

	return sanitizeMarkdownForObsidian(
		[`# ${paperTitle}`, body].filter(Boolean).join("\n\n").trim()
	);
}

function normalizeRemoteSourceText(source: string): string {
	return sanitizeMarkdownForObsidian(
		source.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
	);
}

function absolutizeUrl(rawUrl: string | null | undefined, baseUrl: string): string | null {
	if (!rawUrl) return null;
	try {
		return new URL(rawUrl, baseUrl).toString();
	} catch {
		return null;
	}
}

function extractFormulaText(element: Element): string {
	const candidates = [
		element.getAttribute("alttext"),
		element.getAttribute("aria-label"),
		element.getAttribute("data-tex"),
		element.getAttribute("data-latex"),
		element.textContent,
	];
	for (const candidate of candidates) {
		if (!candidate) continue;
		const normalized = candidate.replace(/\s+/g, " ").trim();
		if (normalized) return sanitizeMathForObsidian(normalized);
	}
	return "";
}

function renderImageMarkdown(element: Element, baseUrl: string): string | null {
	const src = absolutizeUrl(element.getAttribute("src"), baseUrl);
	if (!src) return null;
	const alt = element.getAttribute("alt")?.trim() || "Figure";
	return `![${alt}](${src})`;
}

function collectMarkdownFromElement(element: Element, baseUrl: string): string[] {
	const tag = element.tagName.toLowerCase();
	if (["script", "style", "nav", "footer", "header"].includes(tag)) {
		return [];
	}

	if (/^h[1-6]$/.test(tag)) {
		const level = Number.parseInt(tag.slice(1), 10);
		const text = element.textContent?.replace(/\s+/g, " ").trim();
		return text ? [`${"#".repeat(level)} ${text}`] : [];
	}

	if (tag === "figure") {
		const parts: string[] = [];
		const image = element.querySelector("img");
		const imageMarkdown = image ? renderImageMarkdown(image, baseUrl) : null;
		if (imageMarkdown) parts.push(imageMarkdown);

		const formulaEl =
			element.querySelector("math") ??
			element.querySelector(".ltx_Math") ??
			element.querySelector(".katex-display");
		if (formulaEl) {
			const formula = extractFormulaText(formulaEl);
			if (formula) parts.push(`$$\n${formula}\n$$`);
		}

		const caption =
			element.querySelector("figcaption")?.textContent?.replace(/\s+/g, " ").trim() ??
			"";
		if (caption) parts.push(caption);
		return parts;
	}

	if (tag === "img") {
		const imageMarkdown = renderImageMarkdown(element, baseUrl);
		return imageMarkdown ? [imageMarkdown] : [];
	}

	if (
		tag === "math" ||
		element.classList.contains("ltx_Math") ||
		element.classList.contains("katex-display")
	) {
		const formula = extractFormulaText(element);
		return formula ? [`$$\n${formula}\n$$`] : [];
	}

	if (tag === "pre") {
		const text = element.textContent?.trim();
		return text ? [`\`\`\`\n${text}\n\`\`\``] : [];
	}

	if (tag === "li") {
		const text = element.textContent?.replace(/\s+/g, " ").trim();
		return text ? [`- ${text}`] : [];
	}

	if (tag === "p") {
		const text = element.textContent?.replace(/\s+/g, " ").trim();
		return text ? [text] : [];
	}

	const parts: string[] = [];
	for (const child of Array.from(element.children)) {
		parts.push(...collectMarkdownFromElement(child, baseUrl));
	}
	return parts;
}

export function convertHtmlToStructuredMarkdown(
	html: string,
	baseUrl: string,
	fallbackTitle = "Paper"
): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const root =
		doc.querySelector("main") ??
		doc.querySelector("article") ??
		doc.querySelector("#content") ??
		doc.body;

	if (!root) {
		return `# ${fallbackTitle}`;
	}

	const title = doc.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() || fallbackTitle;
	const lines = collectMarkdownFromElement(root, baseUrl);
	const body = lines.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
	return [`# ${title}`, body].filter(Boolean).join("\n\n").trim();
}

async function requestText(url: string, headers?: Record<string, string>): Promise<string | null> {
	const response = await requestUrl({
		url,
		method: "GET",
		headers,
		throw: false,
	});

	if (response.status === 404) return null;
	if (response.status !== 200) {
		throw new Error(`Source request returned ${response.status}: ${response.text.slice(0, 200)}`);
	}

	return response.text.trim() || null;
}

async function fetchArxivHtmlSource(arxivId: string): Promise<string | null> {
	const html = await requestText(buildArxivHtmlUrl(arxivId), {
		Accept: "text/html,application/xhtml+xml",
	});
	if (!html) return null;
	return convertHtmlToStructuredMarkdown(html, buildArxivHtmlUrl(arxivId), arxivId);
}

async function fetchAr5ivSource(arxivId: string): Promise<string | null> {
	const html = await requestText(buildAr5ivUrl(arxivId), {
		Accept: "text/html,application/xhtml+xml",
	});
	if (!html) return null;
	return convertHtmlToStructuredMarkdown(html, buildAr5ivUrl(arxivId), arxivId);
}

async function fetchJinaReaderSource(arxivId: string): Promise<string | null> {
	const source = await requestText(buildJinaReaderUrl(arxivId), {
		Accept: "text/plain,text/markdown,text/html",
	});
	if (!source) return null;
	if (/^<!doctype html>|^<html[\s>]/i.test(source)) {
		return convertHtmlToStructuredMarkdown(source, buildJinaReaderUrl(arxivId), arxivId);
	}
	return normalizeRemoteSourceText(source);
}

function createAttempt(
	kind: HighEffortSourceKind,
	label: string,
	status: HighEffortSourceAttempt["status"],
	reason?: string
): HighEffortSourceAttempt {
	return { kind, label, status, reason };
}

function buildBundleFromMarkdown(
	paperTitle: string,
	result: SourceFetchResult,
	attempts: HighEffortSourceAttempt[]
): HighEffortSourceBundle {
	const markdown = normalizeRemoteSourceText(result.markdown);
	const pointers = indexMarkdownContentPointers(markdown);
	return {
		paperTitle,
		markdown,
		sourceKind: result.kind,
		sourceLabel: result.label,
		attempts,
		sectionPointers: pointers.sections.filter(isSubstantiveSection),
		paragraphPointers: pointers.paragraphs,
		formulaPointers: pointers.formulas,
		imagePointers: pointers.images,
	};
}

function isSubstantiveSection(pointer: { content: string; sectionPath: readonly string[] }): boolean {
	// Drop sections that are essentially empty or only carry LaTeX/markdown
	// formatting commands. These confuse the high-effort planner and lead the
	// model to generate meta-commentary like "由于原文仅包含格式命令...".
	const stripped = pointer.content
		.replace(/```[\s\S]*?```/g, "")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\\[a-zA-Z]+(\{[^}]*\})*/g, "")
		.replace(/[#>*_`~|\-\\{}[\]()]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (stripped.length >= 80) return true;
	// Always retain explicitly named sections even if short, except the
	// chunker's catch-all "Document" pseudo-heading which is pure noise when
	// empty.
	const lastHeading = pointer.sectionPath[pointer.sectionPath.length - 1] ?? "";
	if (/^document$/i.test(lastHeading.trim())) return false;
	return stripped.length >= 30;
}

export async function buildHighEffortSourceBundle(
	options: HighEffortSourceBundleOptions
): Promise<HighEffortSourceBundle> {
	const attempts: HighEffortSourceAttempt[] = [];
	const { arxivId, settings, paperTitle } = options;

	const trySource = async (
		kind: HighEffortSourceKind,
		label: string,
		loader: () => Promise<string | null>,
		missingReason: string
	): Promise<SourceFetchResult | null> => {
		const attempt = createAttempt(kind, label, "skipped", missingReason);
		attempts.push(attempt);
		try {
			const markdown = await loader();
			if (!markdown) {
				return null;
			}
			attempt.status = "success";
			attempt.reason = undefined;
			return { kind, label, markdown };
		} catch (error) {
			attempt.status = "error";
			attempt.reason = error instanceof Error ? error.message : String(error);
			return null;
		}
	};

	if (settings.preferHuggingFacePaperMarkdown) {
		const huggingFaceResult = await trySource(
			"huggingface-markdown",
			"Hugging Face paper markdown",
			async () => {
				if (!arxivId) return null;
				return fetchPaperMarkdownFromHuggingFace(arxivId, settings);
			},
			arxivId ? "Markdown page not found" : "No arXiv ID available"
		);
		if (huggingFaceResult) {
			return buildBundleFromMarkdown(paperTitle, huggingFaceResult, attempts);
		}
	} else {
		attempts.push(
			createAttempt(
				"huggingface-markdown",
				"Hugging Face paper markdown",
				"skipped",
				"Preference disabled"
			)
		);
	}

	const remoteFetchers: Array<{
		kind: HighEffortSourceKind;
		label: string;
		fetch: (id: string) => Promise<string | null>;
	}> = [
		{
			kind: "arxiv-html",
			label: "arXiv HTML",
			fetch: fetchArxivHtmlSource,
		},
		{
			kind: "ar5iv-html",
			label: "ar5iv HTML",
			fetch: fetchAr5ivSource,
		},
		{
			kind: "jina-reader",
			label: "Jina Reader",
			fetch: fetchJinaReaderSource,
		},
	];

	const remoteResults = await Promise.all(
		remoteFetchers.map((source) =>
			trySource(
				source.kind,
				source.label,
				async () => {
					if (!arxivId) return null;
					return source.fetch(arxivId);
				},
				arxivId ? "Source not available" : "No arXiv ID available"
			)
		)
	);

	for (const result of remoteResults) {
		if (result) {
			return buildBundleFromMarkdown(paperTitle, result, attempts);
		}
	}

	const pages = await parsePdf(options.app, options.pdfFile);
	attempts.push(createAttempt("pdf", "PDF parser", "success"));
	return buildBundleFromMarkdown(
		paperTitle,
		{
			kind: "pdf",
			label: "PDF parser",
			markdown: buildPdfMarkdownSource(paperTitle, pages),
		},
		attempts
	);
}