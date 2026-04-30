import { requestUrl } from "obsidian";
import type { PaperMeta } from "../types";

const BASE = "https://api.semanticscholar.org/graph/v1";
const PAPER_FIELDS =
	"title,authors,year,abstract,citationCount,openAccessPdf,externalIds";

type S2Author = { authorId: string | null; name: string };

type S2Paper = {
	paperId: string;
	title: string | null;
	authors: S2Author[];
	year: number | null;
	abstract: string | null;
	citationCount: number | null;
	openAccessPdf: { url: string } | null;
	externalIds: { ArXiv?: string; DOI?: string } | null;
};

type S2CitationItem = { citingPaper: S2Paper };
type S2ReferenceItem = { citedPaper: S2Paper };
type S2ListResponse<T> = { data: T[] };

// Exported for testing
export function toS2Id(paperId: string): string {
	if (paperId.startsWith("arxiv:")) return "ArXiv:" + paperId.slice(6);
	if (paperId.startsWith("doi:")) return "DOI:" + paperId.slice(4);
	return paperId;
}

export function parsePaperS2(r: S2Paper): PaperMeta {
	const arxivId = r.externalIds?.ArXiv;
	const doi = r.externalIds?.DOI;
	const openAccessUrl = r.openAccessPdf?.url || "";
	const url =
		openAccessUrl ||
		(arxivId ? `https://arxiv.org/abs/${arxivId}` : "") ||
		(doi ? `https://doi.org/${doi}` : "") ||
		`https://www.semanticscholar.org/paper/${r.paperId}`;

	console.log("[parsePaperS2]", {
		paperId: r.paperId,
		arxivId,
		doi,
		openAccessUrl,
		url,
	});

	return {
		id: r.paperId,
		title: r.title || "Untitled",
		authors: (r.authors ?? []).map((a) => a.name),
		year: r.year ?? 0,
		abstract: r.abstract ?? "",
		citationCount: r.citationCount ?? 0,
		url,
		pdfUrl: r.openAccessPdf?.url,
	};
}

function makeHeaders(apiKey: string): Record<string, string> {
	if (apiKey) return { "x-api-key": apiKey };
	return {};
}

async function requestS2<T>(url: string, apiKey: string): Promise<T | null> {
	const responseWithConfiguredKey = await requestUrl({
		url,
		method: "GET",
		headers: makeHeaders(apiKey),
		throw: false,
	});

	if (responseWithConfiguredKey.status === 200) {
		return responseWithConfiguredKey.json as T;
	}

	if (
		apiKey &&
		(responseWithConfiguredKey.status === 401 ||
			responseWithConfiguredKey.status === 403)
	) {
		console.warn(
			`[S2] Request rejected with configured API key (${responseWithConfiguredKey.status}); retrying without key.`
		);
		const responseWithoutKey = await requestUrl({
			url,
			method: "GET",
			headers: {},
			throw: false,
		});
		if (responseWithoutKey.status === 200) {
			return responseWithoutKey.json as T;
		}
		console.warn(`[S2] Request without API key also failed with HTTP ${responseWithoutKey.status}`);
		return null;
	}

	console.warn(`[S2] Request failed with HTTP ${responseWithConfiguredKey.status}`);
	return null;
}

export async function fetchCitations(
	paperId: string,
	maxResults: number,
	apiKey: string
): Promise<PaperMeta[]> {
	const s2Id = toS2Id(paperId);
	const url = `${BASE}/paper/${s2Id}/citations?fields=${PAPER_FIELDS}&limit=${maxResults}`;
	try {
		const json = await requestS2<S2ListResponse<S2CitationItem>>(url, apiKey);
		if (!json) return [];
		return (json.data ?? []).map((item) => parsePaperS2(item.citingPaper));
	} catch {
		return [];
	}
}

export async function fetchReferences(
	paperId: string,
	maxResults: number,
	apiKey: string
): Promise<PaperMeta[]> {
	const s2Id = toS2Id(paperId);
	const url = `${BASE}/paper/${s2Id}/references?fields=${PAPER_FIELDS}&limit=${maxResults}`;
	try {
		const json = await requestS2<S2ListResponse<S2ReferenceItem>>(url, apiKey);
		if (!json) return [];
		return (json.data ?? []).map((item) => parsePaperS2(item.citedPaper));
	} catch (err) {
		console.error("[fetchReferences] error:", err);
		return [];
	}
}
