const STOP_WORDS = new Set([
	"a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
	"has", "he", "in", "is", "it", "its", "of", "on", "that", "the",
	"to", "was", "were", "will", "with", "this", "but", "they", "have",
	"had", "what", "when", "where", "who", "which", "why", "how",
	"not", "all", "can", "been", "being", "each", "few", "more",
	"most", "other", "some", "such", "no", "nor", "too", "very",
	"just", "into", "out", "if", "then", "than", "so", "also", "do",
	"did", "does", "our", "we", "us", "me", "my", "you", "your",
]);

export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

export function computeSimilarity(query: string, corpus: string[]): number[] {
	if (corpus.length === 0) return [];

	const queryTokens = tokenize(query);
	const corpusTokens = corpus.map(tokenize);

	// All unique terms across query + corpus
	const allTerms = new Set<string>([...queryTokens, ...corpusTokens.flat()]);

	// Document frequency: how many corpus docs contain each term (query not counted)
	const N = corpus.length;
	const docFreq: Record<string, number> = {};
	for (const term of allTerms) {
		let df = 0;
		for (const doc of corpusTokens) {
			if (doc.includes(term)) df++;
		}
		docFreq[term] = df;
	}

	// IDF with smoothing — floor at 0 so terms only in query still get a weight
	const idf: Record<string, number> = {};
	for (const term of allTerms) {
		const df = docFreq[term] ?? 0;
		idf[term] = Math.log((N + 1) / (df + 1)) + 1;
	}

	function tfidfVector(tokens: string[]): Record<string, number> {
		const tf: Record<string, number> = {};
		for (const t of tokens) {
			tf[t] = (tf[t] ?? 0) + 1;
		}
		const vec: Record<string, number> = {};
		for (const t of tokens) {
			vec[t] = (tf[t] ?? 0) * (idf[t] ?? 0);
		}
		return vec;
	}

	function dot(a: Record<string, number>, b: Record<string, number>): number {
		let sum = 0;
		for (const [term, val] of Object.entries(a)) {
			if (term in b) sum += val * (b[term] ?? 0);
		}
		return sum;
	}

	function mag(vec: Record<string, number>): number {
		return Math.sqrt(Object.values(vec).reduce((s, v) => s + v * v, 0));
	}

	const queryVec = tfidfVector(queryTokens);
	const corpusVecs = corpusTokens.map(tfidfVector);
	const queryMag = mag(queryVec);

	return corpusVecs.map((cVec) => {
		if (queryMag === 0) return 0;
		const cMag = mag(cVec);
		if (cMag === 0) return 0;
		return dot(queryVec, cVec) / (queryMag * cMag);
	});
}
