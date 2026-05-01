import type { App, TFile } from "obsidian";
import type { CitationRecord } from "../types";
import type { PaperAnalyzerSettings } from "../settings";
import { fetchArxivMeta } from "./arxiv-client";

/** Minimum interval between arXiv API calls to avoid rate-limiting (ms). */
const ARXIV_API_INTERVAL_MS = 500;

// ─── Single-note resolver ─────────────────────────────────────────────────────

/**
 * Resolves citation metadata for a single Obsidian markdown note.
 *
 * Resolution order:
 * 1. Read `title`, `authors`, `published`/`year`, `venue`/`journal`/`booktitle` from frontmatter.
 * 2. Identify arXiv ID via `settings.citationSidebar.arxivFieldAliases`.
 * 3. Identify DOI via `settings.citationSidebar.doiFieldAliases`.
 * 4. If `authors` is missing but an arXiv ID is available, fetch from the arXiv API.
 *
 * Returns `null` if neither an arXiv ID nor a DOI can be found (no identifier → can't cite).
 */
export async function resolveNoteMetadata(
	file: TFile,
	app: App,
	settings: PaperAnalyzerSettings
): Promise<CitationRecord | null> {
	const cache = app.metadataCache.getFileCache(file);
	const fm = cache?.frontmatter as Record<string, unknown> | undefined;
	if (!fm) return null;

	const arxivAliases = settings.citationSidebar.arxivFieldAliases;
	const doiAliases = settings.citationSidebar.doiFieldAliases;

	// ── Identifier fields ──────────────────────────────────────────────────────
	const arxivId = readStringFromAliases(fm, arxivAliases);
	const doi = readStringFromAliases(fm, doiAliases);

	if (!arxivId && !doi) return null;

	// ── Basic metadata from frontmatter ───────────────────────────────────────
	const missing: string[] = [];

	const title = readString(fm, ["title"]) ?? file.basename;

	// Year: prefer explicit `year` field, then extract from `published`
	let year = 0;
	const yearRaw = fm["year"];
	if (typeof yearRaw === "number" && yearRaw > 0) {
		year = yearRaw;
	} else if (typeof yearRaw === "string" && /^\d{4}$/.test(yearRaw.trim())) {
		year = parseInt(yearRaw.trim(), 10);
	} else {
		const publishedRaw = readString(fm, ["published", "date"]);
		if (publishedRaw) {
			const match = /(\d{4})/.exec(publishedRaw);
			if (match?.[1]) year = parseInt(match[1], 10);
		}
	}
	if (year === 0) missing.push("year");

	// Authors: read from frontmatter (array or comma-separated string)
	let authors = readAuthors(fm);

	// Venue
	const venue = readString(fm, ["venue", "booktitle", "journal"]);

	// ── API fallback for authors ───────────────────────────────────────────────
	if (authors.length === 0 && arxivId) {
		try {
			const meta = await fetchArxivMeta(arxivId);
			authors = meta.authors;
			if (year === 0 && meta.published) {
				const m = /(\d{4})/.exec(meta.published);
				if (m?.[1]) {
					year = parseInt(m[1], 10);
					missing.splice(missing.indexOf("year"), 1);
				}
			}
		} catch {
			missing.push("authors");
		}
	} else if (authors.length === 0) {
		missing.push("authors");
	}

	// URL: prefer DOI permalink, then arXiv abstract page
	const url =
		readString(fm, ["url"]) ??
		(doi ? `https://doi.org/${doi}` : undefined) ??
		(arxivId ? `https://arxiv.org/abs/${arxivId}` : undefined) ??
		"";

	return {
		title,
		authors,
		year,
		arxivId: arxivId ?? undefined,
		doi: doi ?? undefined,
		venue: venue ?? undefined,
		url,
		missingFields: missing,
	};
}

// ─── Batch tag resolver ───────────────────────────────────────────────────────

/**
 * Finds all markdown notes with the given tag (frontmatter `tags` array),
 * resolves citation metadata for each, and returns the successful results.
 *
 * @param tag        Tag to filter by (with or without leading `#`, case-insensitive).
 * @param app        Obsidian App instance.
 * @param settings   Plugin settings (for field aliases).
 * @param onProgress Optional callback called after each note is processed.
 */
export async function resolveTaggedNotes(
	tag: string,
	app: App,
	settings: PaperAnalyzerSettings,
	onProgress?: (done: number, total: number, lastFile: string) => void
): Promise<CitationRecord[]> {
	const normalizedTag = normalizeTag(tag);
	const matchingFiles = getFilesWithTag(app, normalizedTag);

	const results: CitationRecord[] = [];
	for (let i = 0; i < matchingFiles.length; i++) {
		const file = matchingFiles[i];
		if (!file) continue;
		try {
			const record = await resolveNoteMetadata(file, app, settings);
			if (record) results.push(record);
		} catch {
			// Skip files that fail to resolve
		}
		onProgress?.(i + 1, matchingFiles.length, file.basename);
		// Throttle arXiv API calls
		if (i < matchingFiles.length - 1) {
			await sleep(ARXIV_API_INTERVAL_MS);
		}
	}
	return results;
}

/**
 * Returns the count of notes matching the tag without resolving full metadata.
 * Useful for real-time UI feedback.
 */
export function countFilesWithTag(app: App, tag: string): number {
	const normalizedTag = normalizeTag(tag);
	return getFilesWithTag(app, normalizedTag).length;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeTag(tag: string): string {
	return tag.replace(/^#/, "").trim().toLowerCase();
}

function getFilesWithTag(app: App, normalizedTag: string): TFile[] {
	return app.vault
		.getMarkdownFiles()
		.filter((file) => {
			const cache = app.metadataCache.getFileCache(file);
			if (!cache) return false;

			// Check CachedMetadata.tags (inline tags) and frontmatterTags
			const allTags: string[] = [];

			const fm = cache.frontmatter as Record<string, unknown> | undefined;
			if (fm) {
				const fmTags = fm["tags"];
				if (Array.isArray(fmTags)) {
					for (const t of fmTags) {
						if (typeof t === "string") allTags.push(t);
					}
				} else if (typeof fmTags === "string") {
					allTags.push(...fmTags.split(",").map((s) => s.trim()));
				}
			}

			// Also check inline tags from the cache
			if (cache.tags) {
				for (const tagObj of cache.tags) {
					allTags.push(tagObj.tag);
				}
			}

			return allTags.some(
				(t) => normalizeTag(t) === normalizedTag
			);
		});
}

function readStringFromAliases(
	fm: Record<string, unknown>,
	aliases: string[]
): string | null {
	for (const alias of aliases) {
		const val = fm[alias];
		if (typeof val === "string" && val.trim()) return val.trim();
	}
	return null;
}

function readString(
	fm: Record<string, unknown>,
	keys: string[]
): string | null {
	for (const key of keys) {
		const val = fm[key];
		if (typeof val === "string" && val.trim()) return val.trim();
	}
	return null;
}

function readAuthors(fm: Record<string, unknown>): string[] {
	const raw = fm["authors"];
	if (Array.isArray(raw)) {
		return raw
			.filter((a): a is string => typeof a === "string")
			.map((a) => a.trim())
			.filter(Boolean);
	}
	if (typeof raw === "string" && raw.trim()) {
		return raw
			.split(/,(?![^(]*\))/) // split by comma not inside parentheses
			.map((a) => a.trim())
			.filter(Boolean);
	}
	return [];
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
