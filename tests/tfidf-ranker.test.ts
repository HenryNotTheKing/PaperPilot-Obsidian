import { describe, it, expect } from "vitest";
import { computeSimilarity, tokenize } from "../src/services/tfidf-ranker";

describe("tokenize", () => {
	it("lowercases and splits on non-alphanumeric", () => {
		const tokens = tokenize("Hello World! Neural Networks are great.");
		expect(tokens).toContain("hello");
		expect(tokens).toContain("world");
		expect(tokens).toContain("neural");
	});

	it("filters stop words", () => {
		const tokens = tokenize("the quick brown fox jumps over the lazy dog");
		expect(tokens).not.toContain("the");
		expect(tokens).toContain("quick");
	});

	it("filters tokens shorter than 2 chars", () => {
		const tokens = tokenize("a b c d e");
		expect(tokens).toHaveLength(0);
	});
});

describe("computeSimilarity", () => {
	it("returns 1.0 for identical texts", () => {
		const corpus = ["machine learning is great"];
		const score = computeSimilarity("machine learning is great", corpus)[0];
		expect(score).toBeCloseTo(1.0, 2);
	});

	it("returns near 0 for unrelated texts", () => {
		const corpus = ["cooking recipes pasta pizza"];
		const score = computeSimilarity("quantum computing entanglement", corpus)[0];
		expect(score).toBeLessThan(0.1);
	});

	it("returns scores in 0-1 range", () => {
		const corpus = [
			"deep learning neural networks",
			"cooking pasta recipes",
			"quantum computing cryptography",
		];
		const scores = computeSimilarity("machine learning", corpus);
		scores.forEach((s) => {
			expect(s).toBeGreaterThanOrEqual(0);
			expect(s).toBeLessThanOrEqual(1);
		});
	});

	it("ranks related paper higher than unrelated", () => {
		const corpus = [
			"cooking pasta tomato sauce recipe",
			"machine learning neural networks deep learning",
			"astronomy stars galaxies universe",
		];
		const scores = computeSimilarity("deep neural network learning", corpus);
		expect(scores[1]).toBeGreaterThan(scores[0]);
		expect(scores[1]).toBeGreaterThan(scores[2]);
	});

	it("returns empty array for empty corpus", () => {
		expect(computeSimilarity("anything", [])).toEqual([]);
	});

	it("returns 0 for empty query", () => {
		const scores = computeSimilarity("", ["some text here"]);
		expect(scores[0]).toBe(0);
	});
});
