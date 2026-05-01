import type { CitationRecord, CitationBibEntryType } from "../types";

// ─── Venue presets ────────────────────────────────────────────────────────────

export interface VenuePreset {
	id: string;
	label: string;
	/** BibTeX booktitle */
	booktitle: string;
	entryType: CitationBibEntryType;
}

export const VENUE_PRESETS: VenuePreset[] = [
	{
		id: "neurips",
		label: "NeurIPS",
		booktitle: "Advances in Neural Information Processing Systems",
		entryType: "inproceedings",
	},
	{
		id: "icml",
		label: "ICML",
		booktitle: "Proceedings of the 40th International Conference on Machine Learning",
		entryType: "inproceedings",
	},
	{
		id: "iclr",
		label: "ICLR",
		booktitle: "International Conference on Learning Representations",
		entryType: "inproceedings",
	},
	{
		id: "cvpr",
		label: "CVPR",
		booktitle:
			"Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition",
		entryType: "inproceedings",
	},
	{
		id: "eccv",
		label: "ECCV",
		booktitle: "European Conference on Computer Vision",
		entryType: "inproceedings",
	},
	{
		id: "iccv",
		label: "ICCV",
		booktitle:
			"Proceedings of the IEEE/CVF International Conference on Computer Vision",
		entryType: "inproceedings",
	},
	{
		id: "aaai",
		label: "AAAI",
		booktitle: "Proceedings of the AAAI Conference on Artificial Intelligence",
		entryType: "inproceedings",
	},
	{
		id: "acl",
		label: "ACL",
		booktitle:
			"Proceedings of the 61st Annual Meeting of the Association for Computational Linguistics",
		entryType: "inproceedings",
	},
	{
		id: "emnlp",
		label: "EMNLP",
		booktitle: "Proceedings of the 2024 Conference on Empirical Methods in Natural Language Processing",
		entryType: "inproceedings",
	},
	{
		id: "naacl",
		label: "NAACL",
		booktitle: "Proceedings of the 2024 Conference of the North American Chapter of the Association for Computational Linguistics",
		entryType: "inproceedings",
	},
	{
		id: "kdd",
		label: "KDD",
		booktitle:
			"Proceedings of the 30th ACM SIGKDD Conference on Knowledge Discovery and Data Mining",
		entryType: "inproceedings",
	},
];

// ─── Cite key generation ──────────────────────────────────────────────────────

/**
 * Generates a BibTeX cite key like `vaswani2017attention`.
 * Format: first-author-last-name + year + first-title-word (lower-cased, non-alpha stripped).
 */
export function generateCiteKey(record: CitationRecord): string {
	const firstAuthor = record.authors[0] ?? "unknown";
	// Try to get the last name: split by space and take the last token
	const nameParts = firstAuthor.trim().split(/\s+/);
	const lastName = (nameParts[nameParts.length - 1] ?? firstAuthor)
		.toLowerCase()
		.replace(/[^a-z]/g, "");

	const year = record.year > 0 ? String(record.year) : "0000";

	// First meaningful word of the title (skip short words like "a", "the", "of")
	const titleWords = record.title
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, "")
		.split(/\s+/)
		.filter((w) => w.length > 2 && !["the", "and", "for", "with", "from", "are", "has"].includes(w));
	const titleWord = titleWords[0] ?? "paper";

	return `${lastName}${year}${titleWord}`;
}

// ─── Entry type inference ─────────────────────────────────────────────────────

/**
 * Infers the best BibTeX entry type from available fields:
 * - Has venue/booktitle → @inproceedings
 * - Has DOI but no venue → @article
 * - Otherwise → @misc (e.g. arXiv preprint)
 */
export function inferBibEntryType(record: CitationRecord): CitationBibEntryType {
	if (record.entryType) return record.entryType;
	if (record.venue) return "inproceedings";
	if (record.doi) return "article";
	return "misc";
}

// ─── BibTeX formatter ─────────────────────────────────────────────────────────

function escapeBibTeX(s: string): string {
	return s
		.replace(/\\/g, "\\textbackslash{}")
		.replace(/[&%$#_{}]/g, (c) => `\\${c}`)
		.replace(/~/g, "\\textasciitilde{}")
		.replace(/\^/g, "\\textasciicircum{}");
}

function formatBibAuthors(authors: string[]): string {
	return authors.map(escapeBibTeX).join(" and ");
}

/**
 * Formats a `CitationRecord` as a BibTeX entry.
 * @param record     The paper metadata.
 * @param venuePresetId  Optional VENUE_PRESETS id to override the venue / entry type.
 */
export function formatBibTeX(record: CitationRecord, venuePresetId?: string): string {
	const preset = venuePresetId
		? VENUE_PRESETS.find((p) => p.id === venuePresetId)
		: undefined;

	const entryType = preset?.entryType ?? inferBibEntryType(record);
	const citeKey = generateCiteKey(record);

	const lines: string[] = [];
	lines.push(`@${entryType}{${citeKey},`);
	lines.push(`  title     = {${escapeBibTeX(record.title)}},`);

	if (record.authors.length > 0) {
		lines.push(`  author    = {${formatBibAuthors(record.authors)}},`);
	}

	if (record.year > 0) {
		lines.push(`  year      = {${record.year}},`);
	}

	if (entryType === "inproceedings") {
		const booktitle = preset?.booktitle ?? record.venue ?? "";
		if (booktitle) {
			lines.push(`  booktitle = {${escapeBibTeX(booktitle)}},`);
		}
	} else if (entryType === "article") {
		const journal = record.venue ?? "";
		if (journal) {
			lines.push(`  journal   = {${escapeBibTeX(journal)}},`);
		}
	} else {
		// @misc – arXiv preprint
		if (record.arxivId) {
			lines.push(`  howpublished = {arXiv preprint arXiv:${record.arxivId}},`);
		}
	}

	if (record.doi) {
		lines.push(`  doi       = {${record.doi}},`);
	}

	if (record.url) {
		lines.push(`  url       = {${record.url}},`);
	}

	lines.push(`}`);
	return lines.join("\n");
}

// ─── IEEE formatter ───────────────────────────────────────────────────────────

/**
 * Formats a `CitationRecord` as an IEEE-style reference.
 * Example: [1] A. Vaswani et al., "Attention Is All You Need," in NeurIPS, 2017.
 */
export function formatIEEE(record: CitationRecord, index: number): string {
	const authorsFormatted = formatIEEEAuthors(record.authors);
	const title = record.title;
	const year = record.year > 0 ? String(record.year) : "n.d.";
	const venue = record.venue ?? (record.arxivId ? `arXiv:${record.arxivId}` : "");
	const inVenue = venue ? `, in *${venue}*` : "";
	const doiSuffix = record.doi ? `. doi: ${record.doi}` : "";

	return `[${index}] ${authorsFormatted}, "${title}"${inVenue}, ${year}${doiSuffix}.`;
}

function formatIEEEAuthors(authors: string[]): string {
	if (authors.length === 0) return "Unknown";
	if (authors.length > 3) {
		return `${abbreviateAuthor(authors[0] ?? "")} et al.`;
	}
	return authors.map(abbreviateAuthor).join(", ");
}

/** Converts "Ashish Vaswani" → "A. Vaswani" */
function abbreviateAuthor(fullName: string): string {
	const parts = fullName.trim().split(/\s+/);
	if (parts.length === 1) return parts[0] ?? fullName;
	const initials = parts
		.slice(0, -1)
		.map((p) => `${p.charAt(0).toUpperCase()}.`)
		.join(" ");
	return `${initials} ${parts[parts.length - 1]}`;
}

// ─── Custom template formatter ────────────────────────────────────────────────

/**
 * Applies a custom template string with `{placeholder}` syntax.
 * Available: {title} {authors} {year} {doi} {arxiv_id} {url} {venue}
 */
export function formatCustom(record: CitationRecord, template: string): string {
	const authorStr = record.authors.join(", ");
	const replacements: Record<string, string> = {
		title: record.title,
		authors: authorStr,
		year: record.year > 0 ? String(record.year) : "",
		doi: record.doi ?? "",
		arxiv_id: record.arxivId ?? "",
		url: record.url ?? "",
		venue: record.venue ?? "",
	};
	return template.replace(/\{(\w+)\}/g, (_match, key: string) => replacements[key] ?? _match);
}
