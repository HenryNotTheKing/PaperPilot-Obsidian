import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import {
	buildLlmRequest,
	callLlmText,
	callLlmTextWithMeta,
	extractLlmText,
	extractLlmTextResult,
	formatLlmErrorForDisplay,
	getLlmRetryDelayMs,
	inferLlmProviderFromBaseUrl,
	isTruncatedLlmStopReason,
	isOverloadedError,
	parseHighlights,
	parseLlmErrorResponse,
	resolveLlmProvider,
	stripThinkingTags,
	shouldRetryLlmRequest,
} from "../src/services/llm-client";
import {
	getSharedLlmConcurrencyManager,
	resetSharedLlmConcurrencyManager,
} from "../src/services/adaptive-llm-concurrency";

const requestUrlMock = vi.mocked(requestUrl);

function createResponse(
	overrides: Partial<{
		status: number;
		text: string;
		json: unknown;
		headers: Record<string, string>;
	}> = {}
) {
	return {
		status: 200,
		text: '{"choices":[{"message":{"content":"ok"}}]}',
		json: {
			choices: [{ message: { content: "ok" } }],
		},
		headers: {},
		...overrides,
	};
}

beforeEach(() => {
	requestUrlMock.mockReset();
	requestUrlMock.mockImplementation(() => {
		throw new Error("requestUrl is not available in unit tests");
	});
	resetSharedLlmConcurrencyManager(3);
});

afterEach(() => {
	vi.useRealTimers();
	resetSharedLlmConcurrencyManager(3);
});

describe("parseHighlights", () => {
	it("extracts highlights from valid JSON string", () => {
		const json = JSON.stringify({
			highlights: [
				{ exact_text: "Attention is all you need.", type: "contribution" },
			],
		});
		const result = parseHighlights(json, 1, "abstract");
		expect(result).toHaveLength(1);
		expect(result[0]?.exact_text).toBe("Attention is all you need.");
		expect(result[0]?.pageNum).toBe(1);
		expect(result[0]?.sectionTag).toBe("abstract");
	});

	it("returns empty array for JSON with no highlights key", () => {
		const result = parseHighlights("{}", 1, "method");
		expect(result).toEqual([]);
	});

	it("returns empty array on malformed JSON", () => {
		const result = parseHighlights("not json", 1, "experiment");
		expect(result).toEqual([]);
	});

	it("filters out highlights with empty exact_text", () => {
		const json = JSON.stringify({
			highlights: [
				{ exact_text: "", type: "contribution" },
				{ exact_text: "Valid text.", type: "motivation" },
			],
		});
		const result = parseHighlights(json, 1, "abstract");
		expect(result).toHaveLength(1);
		expect(result[0]?.exact_text).toBe("Valid text.");
	});

	it("attaches pageNum and sectionTag from parameters", () => {
		const json = JSON.stringify({
			highlights: [{ exact_text: "Some text.", type: "algorithm" }],
		});
		const result = parseHighlights(json, 7, "method");
		expect(result[0]?.pageNum).toBe(7);
		expect(result[0]?.sectionTag).toBe("method");
	});
});

describe("LLM provider detection", () => {
	it("detects Anthropic from the base URL", () => {
		expect(inferLlmProviderFromBaseUrl("https://api.anthropic.com")).toBe(
			"anthropic"
		);
		expect(inferLlmProviderFromBaseUrl("https://api.anthropic.com/v1")).toBe(
			"anthropic"
		);
	});

	it("defaults to OpenAI-compatible for non-Anthropic URLs", () => {
		expect(inferLlmProviderFromBaseUrl("https://api.siliconflow.cn/v1")).toBe(
			"openai"
		);
	});

	it("lets manual provider override win over base URL inference", () => {
		expect(
			resolveLlmProvider({
				baseUrl: "https://my-proxy.example.com/v1",
				provider: "anthropic",
			})
		).toBe("anthropic");
	});
});

describe("buildLlmRequest", () => {
	it("builds an OpenAI-compatible request shape", () => {
		const request = buildLlmRequest(
			{
				baseUrl: "https://api.siliconflow.cn/v1",
				apiKey: "sk-openai",
				model: "Qwen/Qwen3-8B",
				provider: "auto",
			},
			"system prompt",
			"user content"
		);

		expect(request.provider).toBe("openai");
		expect(request.url).toBe(
			"https://api.siliconflow.cn/v1/chat/completions"
		);
		expect(request.headers).toEqual({
			Authorization: "Bearer sk-openai",
			"Content-Type": "application/json",
		});
		expect(request.body).toMatchObject({
			model: "Qwen/Qwen3-8B",
			messages: [
				{ role: "system", content: "system prompt" },
				{ role: "user", content: "user content" },
			],
			response_format: { type: "json_object" },
			temperature: 0.1,
			max_tokens: 1024,
			enable_thinking: false,
		});
		expect(request.body).not.toHaveProperty("thinking_budget_tokens");
	});

	it("builds an Anthropic messages request shape", () => {
		const request = buildLlmRequest(
			{
				baseUrl: "https://api.anthropic.com",
				apiKey: "sk-ant",
				model: "claude-sonnet-4-20250514",
				provider: "auto",
			},
			"system prompt",
			"user content"
		);

		expect(request.provider).toBe("anthropic");
		expect(request.url).toBe("https://api.anthropic.com/v1/messages");
		expect(request.headers).toEqual({
			"Content-Type": "application/json",
			"x-api-key": "sk-ant",
			"anthropic-version": "2023-06-01",
		});
		expect(request.body).toMatchObject({
			model: "claude-sonnet-4-20250514",
			system: "system prompt",
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "user content" }],
				},
			],
			temperature: 0.1,
			max_tokens: 1024,
		});
	});

	it("omits json response_format for text-mode OpenAI requests", () => {
		const request = buildLlmRequest(
			{
				baseUrl: "https://api.siliconflow.cn/v1",
				apiKey: "sk-openai",
				model: "Qwen/Qwen3-8B",
				provider: "openai",
			},
			"system prompt",
			"user content",
			{ responseMode: "text", maxTokens: 1500 }
		);

		expect(request.provider).toBe("openai");
		expect(request.body).toMatchObject({
			max_tokens: 1500,
			temperature: 0.1,
		});
		expect(request.body).not.toHaveProperty("response_format");
	});
});

describe("extractLlmText", () => {
	it("reads OpenAI-compatible response content", () => {
		expect(
			extractLlmText("openai", {
				choices: [{ message: { content: '{"highlights":[]}' } }],
			})
		).toBe('{"highlights":[]}');
	});

	it("extracts stop-reason metadata for OpenAI-compatible responses", () => {
		expect(
			extractLlmTextResult("openai", {
				choices: [
					{
						finish_reason: "length",
						message: { content: '{"highlights":[]}' },
					},
				],
			})
		).toEqual({
			text: '{"highlights":[]}',
			stopReason: "length",
			truncated: true,
		});
	});

	it("reads Anthropic text blocks", () => {
		expect(
			extractLlmText("anthropic", {
				content: [
					{ type: "text", text: '{"highlights":[]}' },
					{ type: "text", text: '{"extra":true}' },
				],
			})
		).toBe('{"highlights":[]}\n{"extra":true}');
	});

	it("strips think tags from extracted content", () => {
		expect(
			extractLlmText("openai", {
				choices: [
					{ message: { content: "<think>internal reasoning</think>## Final answer" } },
				],
			})
		).toBe("## Final answer");

		expect(
			extractLlmText("anthropic", {
				content: [{ type: "text", text: "<think>draft</think>{\"highlights\":[]}" }],
			})
		).toBe('{"highlights":[]}');
	});

	it("detects truncated stop reasons", () => {
		expect(isTruncatedLlmStopReason("length")).toBe(true);
		expect(isTruncatedLlmStopReason("max_tokens")).toBe(true);
		expect(isTruncatedLlmStopReason("stop")).toBe(false);
		expect(isTruncatedLlmStopReason(null)).toBe(false);
	});
});

describe("stripThinkingTags", () => {
	it("removes standalone think tags and trims the result", () => {
		expect(stripThinkingTags("  <think>hidden</think>Visible output  ")).toBe(
			"Visible output"
		);
	});
});

describe("LLM retry policy", () => {
	it("retries transient overloaded and rate-limited responses", () => {
		expect(shouldRetryLlmRequest(429)).toBe(true);
		expect(shouldRetryLlmRequest(503)).toBe(true);
		expect(shouldRetryLlmRequest(529)).toBe(true);
		expect(shouldRetryLlmRequest(400)).toBe(false);
		expect(shouldRetryLlmRequest(401)).toBe(false);
	});

	it("uses exponential backoff when retry-after is absent", () => {
		expect(getLlmRetryDelayMs(0)).toBe(1000);
		expect(getLlmRetryDelayMs(1)).toBe(2000);
		expect(getLlmRetryDelayMs(3)).toBe(8000);
	});

	it("respects retry-after when provided", () => {
		expect(getLlmRetryDelayMs(0, "3")).toBe(3000);
		expect(getLlmRetryDelayMs(0, "60")).toBe(8000);
	});

	it("parses overload response details including request id", () => {
		const payload = {
			type: "error",
			error: {
				type: "overloaded error",
				message: "overloaded error (529)",
				request_id: "063662e80550fha0e1591059eb22567b",
			},
		};

		const error = parseLlmErrorResponse(
			{
				provider: "openai",
				url: "https://example.com/chat/completions",
				headers: {},
				body: {} as never,
			},
			createResponse({
				status: 529,
				text: JSON.stringify(payload),
				json: payload,
				headers: { "retry-after": "4" },
			})
		);

		expect(error.status).toBe(529);
		expect(error.errorType).toBe("overloaded error");
		expect(error.requestId).toBe("063662e80550fha0e1591059eb22567b");
		expect(error.retryAfterMs).toBe(4000);
		expect(error.isOverloaded).toBe(true);
		expect(error.message).toContain("request id: 063662e80550fha0e1591059eb22567b");
	});

	it("does not misclassify generic 503 responses as overload", () => {
		expect(
			isOverloadedError({ status: 503, rawMessage: "service temporarily unavailable" })
		).toBe(false);
		expect(
			isOverloadedError({ status: 503, rawMessage: "server overloaded right now" })
		).toBe(true);
		expect(
			isOverloadedError({ status: 529, rawMessage: "unknown upstream error" })
		).toBe(true);
		expect(
			isOverloadedError({ status: 500, rawMessage: "plain internal server error" })
		).toBe(false);
	});

	it("retries overload responses and reduces shared concurrency", async () => {
		const payload = {
			type: "error",
			error: {
				type: "overloaded error",
				message: "overloaded error (529)",
				requestId: "req_overload_1",
			},
		};

		requestUrlMock
			.mockResolvedValueOnce(
				createResponse({
					status: 529,
					text: JSON.stringify(payload),
					json: payload,
					headers: { "retry-after": "0" },
				})
			)
			.mockResolvedValueOnce(
				createResponse({
					status: 200,
					text: '{"choices":[{"message":{"content":"recovered"}}]}',
					json: {
						choices: [{ message: { content: "recovered" } }],
					},
				})
			);

		const result = await callLlmText(
			{
				baseUrl: "https://api.siliconflow.cn/v1",
				apiKey: "sk-test",
				model: "test-model",
				provider: "openai",
				concurrencyLimit: 3,
			},
			"system prompt",
			"user content"
		);

		expect(result).toBe("recovered");
		expect(getSharedLlmConcurrencyManager().getSnapshot().currentConcurrency).toBe(1);
		expect(getSharedLlmConcurrencyManager().getSnapshot().recentOverloadCount).toBe(1);
	});

	it("limits concurrent LLM requests across parallel calls", async () => {
		let inFlight = 0;
		let maxInFlight = 0;

		requestUrlMock.mockImplementation(async () => {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((resolve) => window.setTimeout(resolve, 5));
			inFlight -= 1;
			return createResponse({
				status: 200,
				text: '{"choices":[{"message":{"content":"parallel ok"}}]}',
				json: {
					choices: [{ message: { content: "parallel ok" } }],
				},
			});
		});

		const config = {
			baseUrl: "https://api.siliconflow.cn/v1",
			apiKey: "sk-test",
			model: "test-model",
			provider: "openai" as const,
			concurrencyLimit: 2,
		};

		const results = await Promise.all(
			Array.from({ length: 5 }, (_, index) =>
				callLlmText(config, "system prompt", `user ${index}`)
			)
		);

		expect(results).toEqual(Array(5).fill("parallel ok"));
		expect(maxInFlight).toBeLessThanOrEqual(2);
	});

	it("returns truncation metadata from successful calls", async () => {
		requestUrlMock.mockResolvedValueOnce(
			createResponse({
				status: 200,
				text: '{"choices":[{"message":{"content":"{\\"ok\\":true}"},"finish_reason":"length"}]}',
				json: {
					choices: [
						{
							message: { content: '{"ok":true}' },
							finish_reason: "length",
						},
					],
				},
			})
		);

		const result = await callLlmTextWithMeta(
			{
				baseUrl: "https://api.siliconflow.cn/v1",
				apiKey: "sk-test",
				model: "test-model",
				provider: "openai",
				concurrencyLimit: 3,
			},
			"system prompt",
			"user content"
		);

		expect(result).toEqual({
			text: '{"ok":true}',
			stopReason: "length",
			truncated: true,
		});
	});

	it("formats overload errors with request ids for queue display", () => {
		const payload = {
			type: "error",
			error: {
				type: "overloaded error",
				message: "overloaded error (529)",
				request_id: "req_display_1",
			},
		};
		const error = parseLlmErrorResponse(
			{
				provider: "openai",
				url: "https://example.com/chat/completions",
				headers: {},
				body: {} as never,
			},
			createResponse({
				status: 529,
				text: JSON.stringify(payload),
				json: payload,
			})
		);

		expect(formatLlmErrorForDisplay(error)).toContain("request id: req_display_1");
		expect(formatLlmErrorForDisplay(error)).toContain(
			"Concurrency reduced automatically"
		);
	});
});
