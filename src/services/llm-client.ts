import { requestUrl } from "obsidian";
import { getSharedLlmConcurrencyManager } from "./adaptive-llm-concurrency";
import type {
	HighlightResult,
	LlmApiErrorLike,
	LlmConfig,
	LlmProvider,
	SectionTag,
	TextChunk,
} from "../types";

interface OpenAiChatRequestBody {
	model: string;
	messages: Array<{ role: string; content: string }>;
	response_format?: { type: string };
	temperature: number;
	max_tokens: number;
	enable_thinking: boolean;
	thinking_budget_tokens?: number;
}

interface AnthropicMessagesRequestBody {
	model: string;
	system: string;
	messages: Array<{
		role: "user";
		content: Array<{ type: "text"; text: string }>;
	}>;
	temperature: number;
	max_tokens: number;
}

type SupportedLlmProvider = Exclude<LlmProvider, "auto">;
type LlmRequestBody = OpenAiChatRequestBody | AnthropicMessagesRequestBody;
type LlmResponse = Awaited<ReturnType<typeof requestUrl>>;
type JsonRecord = Record<string, unknown>;

export interface LlmRequestDescriptor {
	provider: SupportedLlmProvider;
	url: string;
	headers: Record<string, string>;
	body: LlmRequestBody;
}

export interface LlmRequestOptions {
	responseMode?: "json" | "text";
	maxTokens?: number;
	temperature?: number;
	disableThinking?: boolean;
}

export interface LlmTextResult {
	text: string;
	stopReason: string | null;
	truncated: boolean;
}

const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const MAX_LLM_RETRY_ATTEMPTS = 4;
const LLM_RETRY_BASE_DELAY_MS = 1000;
const LLM_RETRY_MAX_DELAY_MS = 8000;
const RETRYABLE_LLM_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const TRUNCATED_STOP_REASON_TOKENS = [
	"length",
	"max_tokens",
	"max tokens",
	"max_output_tokens",
	"output_length",
	"token_limit",
	"token limit",
];
const OVERLOAD_ERROR_TOKENS = [
	"overloaded",
	"overload",
	"rate limit",
	"too many requests",
	"server busy",
	"capacity",
];

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collapseWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function normalizeLookupKey(value: string): string {
	return value.replace(/[\s_-]/g, "").toLowerCase();
}

function getStringField(
	record: JsonRecord | null | undefined,
	...keys: string[]
): string | null {
	if (!record) return null;
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}
	return null;
}

function getNestedErrorRecord(payload: JsonRecord | null): JsonRecord | null {
	const nestedError = payload?.["error"];
	return isRecord(nestedError) ? nestedError : null;
}

function extractResponsePayload(response: LlmResponse): JsonRecord | null {
	const payload = (response as { json?: unknown }).json;
	if (isRecord(payload)) {
		return payload;
	}

	const text = response.text?.trim();
	if (!text || !/^[{[]/.test(text)) {
		return null;
	}

	try {
		const parsed = JSON.parse(text) as unknown;
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function findFirstStringValue(
	value: unknown,
	matcher: (normalizedKey: string) => boolean,
	depth = 0
): string | null {
	if (depth > 5) return null;

	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findFirstStringValue(item, matcher, depth + 1);
			if (found) return found;
		}
		return null;
	}

	if (!isRecord(value)) return null;

	for (const key in value) {
		if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
		const nestedValue = value[key];
		if (typeof nestedValue === "string" && matcher(normalizeLookupKey(key))) {
			const trimmed = nestedValue.trim();
			if (trimmed) return trimmed;
		}
	}

	for (const key in value) {
		if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
		const nestedValue = value[key];
		const found = findFirstStringValue(nestedValue, matcher, depth + 1);
		if (found) return found;
	}

	return null;
}

function extractRequestId(payload: JsonRecord | null, response: LlmResponse): string | null {
	return (
		findFirstStringValue(payload, (normalizedKey) => normalizedKey === "requestid") ??
		getHeaderValue((response as { headers?: unknown }).headers, "x-request-id") ??
		getHeaderValue((response as { headers?: unknown }).headers, "request-id") ??
		getHeaderValue((response as { headers?: unknown }).headers, "anthropic-request-id")
	);
}

function extractErrorType(payload: JsonRecord | null): string | null {
	const nestedError = getNestedErrorRecord(payload);
	return (
		getStringField(nestedError, "type", "code") ??
		getStringField(payload, "type", "code")
	);
}

function extractErrorMessage(
	payload: JsonRecord | null,
	responseText: string,
	status: number
): string {
	const nestedError = getNestedErrorRecord(payload);
	return (
		getStringField(nestedError, "message", "detail", "error") ??
		getStringField(payload, "message", "detail", "error_description") ??
		collapseWhitespace(responseText).slice(0, 240) ??
		`HTTP ${status}`
	);
}

function createLlmApiError(details: {
	status?: number;
	provider?: SupportedLlmProvider;
	requestId?: string | null;
	errorType?: string | null;
	rawMessage: string;
	retryAfterMs?: number | null;
	isRetryable: boolean;
	isOverloaded: boolean;
}): LlmApiErrorLike {
	const statusLabel = details.status
		? `LLM API returned ${details.status}`
		: "LLM request failed";
	const providerLabel = details.provider ? ` (${details.provider})` : "";
	const reason = details.rawMessage.trim() || details.errorType?.trim() || "Unknown error";
	let message = `${statusLabel}${providerLabel}`;
	if (reason) {
		message += `: ${reason}`;
	}
	if (details.requestId) {
		message += ` (request id: ${details.requestId})`;
	}

	const error = new Error(message) as LlmApiErrorLike;
	error.name = "LlmApiError";
	error.status = details.status;
	error.provider = details.provider;
	error.requestId = details.requestId ?? undefined;
	error.errorType = details.errorType ?? undefined;
	error.rawMessage = reason;
	error.retryAfterMs = details.retryAfterMs ?? null;
	error.isRetryable = details.isRetryable;
	error.isOverloaded = details.isOverloaded;
	return error;
}

export function isLlmApiErrorLike(error: unknown): error is LlmApiErrorLike {
	if (!(error instanceof Error)) return false;
	const candidate = error as Partial<LlmApiErrorLike>;
	return (
		typeof candidate.rawMessage === "string" &&
		typeof candidate.isRetryable === "boolean" &&
		typeof candidate.isOverloaded === "boolean"
	);
}

export function isOverloadedError(
	error: Pick<Partial<LlmApiErrorLike>, "status" | "errorType" | "rawMessage"> & {
		message?: string;
	}
): boolean {
	const normalized = [error.errorType, error.rawMessage, error.message]
		.filter((value): value is string => typeof value === "string" && value.length > 0)
		.map((value) => value.toLowerCase())
		.join(" ");
	const hasOverloadToken = OVERLOAD_ERROR_TOKENS.some((token) =>
		normalized.includes(token)
	);

	if (error.status === 429 || error.status === 529) {
		return true;
	}

	if (error.status === 503) {
		return hasOverloadToken;
	}

	return hasOverloadToken && (error.status === undefined || shouldRetryLlmRequest(error.status));
}

export function parseLlmErrorResponse(
	request: LlmRequestDescriptor,
	response: LlmResponse
): LlmApiErrorLike {
	const payload = extractResponsePayload(response);
	const rawMessage = extractErrorMessage(payload, response.text ?? "", response.status);
	const errorType = extractErrorType(payload);
	const retryAfterMs = parseRetryAfterMs(
		getHeaderValue((response as { headers?: unknown }).headers, "retry-after")
	);
	const requestId = extractRequestId(payload, response);
	const overloaded = isOverloadedError({
		status: response.status,
		errorType: errorType ?? undefined,
		rawMessage,
		message: rawMessage,
	});

	return createLlmApiError({
		status: response.status,
		provider: request.provider,
		requestId,
		errorType,
		rawMessage,
		retryAfterMs,
		isRetryable: shouldRetryLlmRequest(response.status) || overloaded,
		isOverloaded: overloaded,
	});
}

function normalizeThrownLlmError(
	error: unknown,
	provider: SupportedLlmProvider
): LlmApiErrorLike {
	if (isLlmApiErrorLike(error)) {
		return error;
	}

	const rawMessage = collapseWhitespace(
		error instanceof Error ? error.message : String(error)
	);
	const overloaded = isOverloadedError({
		rawMessage,
		message: rawMessage,
	});

	return createLlmApiError({
		provider,
		rawMessage: rawMessage || "LLM request failed",
		isRetryable: overloaded || shouldRetryLlmError(error),
		isOverloaded: overloaded,
	});
}

function getRetryDelayForError(
	attemptIndex: number,
	error: LlmApiErrorLike
): number {
	if (typeof error.retryAfterMs === "number" && error.retryAfterMs >= 0) {
		return Math.min(error.retryAfterMs, LLM_RETRY_MAX_DELAY_MS);
	}

	return getLlmRetryDelayMs(attemptIndex);
}

export function formatLlmErrorForDisplay(error: unknown): string {
	if (!isLlmApiErrorLike(error)) {
		return error instanceof Error ? error.message : String(error);
	}

	if (!error.isOverloaded) {
		return error.message;
	}

	const autoReducedSuffix = " Concurrency reduced automatically.";
	return error.message.includes(autoReducedSuffix.trim())
		? error.message
		: `${error.message}${autoReducedSuffix}`;
}

export function inferLlmProviderFromBaseUrl(baseUrl: string): SupportedLlmProvider {
	const normalized = baseUrl.trim().replace(/\/+$/, "").toLowerCase();
	if (!normalized) return "openai";

	try {
		const parsed = new URL(normalized);
		const host = parsed.host.toLowerCase();
		const path = parsed.pathname.toLowerCase();
		if (host.includes("anthropic") || host.includes("claude")) {
			return "anthropic";
		}
		if (
			path.endsWith("/messages") ||
			path.endsWith("/v1/messages") ||
			path.includes("/anthropic/")
		) {
			return "anthropic";
		}
	} catch {
		// Ignore invalid URLs and fall back to substring checks.
	}

	if (
		normalized.includes("anthropic") ||
		normalized.includes("/v1/messages") ||
		normalized.endsWith("/messages")
	) {
		return "anthropic";
	}

	return "openai";
}

export function resolveLlmProvider(
	config: Pick<LlmConfig, "baseUrl" | "provider">
): SupportedLlmProvider {
	if (config.provider && config.provider !== "auto") {
		return config.provider;
	}
	return inferLlmProviderFromBaseUrl(config.baseUrl);
}

function buildOpenAiRequestBody(
	model: string,
	systemPrompt: string,
	userContent: string,
	options: LlmRequestOptions = {}
): OpenAiChatRequestBody {
	const responseMode = options.responseMode ?? "json";
	const disableThinking = options.disableThinking !== false;
	const body: OpenAiChatRequestBody = {
		model,
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userContent },
		],
		temperature: options.temperature ?? DEFAULT_TEMPERATURE,
		max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
		enable_thinking: !disableThinking,
	};
	if (!disableThinking) {
		body.thinking_budget_tokens = 512;
	}
	if (responseMode === "json") {
		body.response_format = { type: "json_object" };
	}
	return body;
}

function buildAnthropicRequestBody(
	model: string,
	systemPrompt: string,
	userContent: string,
	options: LlmRequestOptions = {}
): AnthropicMessagesRequestBody {
	return {
		model,
		system: systemPrompt,
		messages: [
			{
				role: "user",
				content: [{ type: "text", text: userContent }],
			},
		],
		temperature: options.temperature ?? DEFAULT_TEMPERATURE,
		max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
	};
}

export function buildRequestBody(
	provider: SupportedLlmProvider,
	model: string,
	systemPrompt: string,
	userContent: string,
	options: LlmRequestOptions = {}
): LlmRequestBody {
	if (provider === "anthropic") {
		return buildAnthropicRequestBody(model, systemPrompt, userContent, options);
	}
	return buildOpenAiRequestBody(model, systemPrompt, userContent, options);
}

function buildRequestUrl(provider: SupportedLlmProvider, baseUrl: string): string {
	const normalized = baseUrl.replace(/\/+$/, "");
	if (provider === "anthropic") {
		if (/\/messages$/i.test(normalized)) return normalized;
		if (/\/v1$/i.test(normalized)) return `${normalized}/messages`;
		return `${normalized}/v1/messages`;
	}
	if (/\/chat\/completions$/i.test(normalized)) return normalized;
	return `${normalized}/chat/completions`;
}

function buildRequestHeaders(
	provider: SupportedLlmProvider,
	apiKey: string
): Record<string, string> {
	if (provider === "anthropic") {
		return {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": DEFAULT_ANTHROPIC_VERSION,
		};
	}

	return {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/json",
	};
}

export function buildLlmRequest(
	config: LlmConfig,
	systemPrompt: string,
	userContent: string,
	options: LlmRequestOptions = {}
): LlmRequestDescriptor {
	const provider = resolveLlmProvider(config);
	return {
		provider,
		url: buildRequestUrl(provider, config.baseUrl),
		headers: buildRequestHeaders(provider, config.apiKey),
		body: buildRequestBody(
			provider,
			config.model,
			systemPrompt,
			userContent,
			options
		),
	};
}

function extractTextBlocks(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "{}";
	}

	const text = content
		.map((block) => {
			if (typeof block === "string") return block;
			if (!block || typeof block !== "object") return "";
			const record = block as Record<string, unknown>;
			return typeof record["text"] === "string" ? record["text"] : "";
		})
		.filter(Boolean)
		.join("\n");

	return text || "{}";
}

function extractStopReasonFromChoice(choice: unknown): string | null {
	if (!isRecord(choice)) return null;
	return getStringField(choice, "finish_reason", "finishReason", "stop_reason", "stopReason");
}

export function isTruncatedLlmStopReason(value?: string | null): boolean {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return false;
	return TRUNCATED_STOP_REASON_TOKENS.some((token) => normalized.includes(token));
}

export function stripThinkingTags(text: string): string {
	if (!text) return text;
	return text
		.replace(/<think>[\s\S]*?<\/think>/gi, "")
		.replace(/<think>/gi, "")
		.replace(/<\/think>/gi, "")
		.trim();
}

export function extractLlmTextResult(
	provider: SupportedLlmProvider,
	payload: unknown
): LlmTextResult {
	if (!payload || typeof payload !== "object") {
		return {
			text: "{}",
			stopReason: null,
			truncated: false,
		};
	}

	if (provider === "anthropic") {
		const response = payload as {
			content?: unknown;
			stop_reason?: unknown;
			stopReason?: unknown;
		};
		const stopReason =
			typeof response.stop_reason === "string"
				? response.stop_reason
				: typeof response.stopReason === "string"
					? response.stopReason
					: null;
		return {
			text: stripThinkingTags(extractTextBlocks(response.content)),
			stopReason,
			truncated: isTruncatedLlmStopReason(stopReason),
		};
	}

	const response = payload as {
		choices?: Array<{
			finish_reason?: unknown;
			finishReason?: unknown;
			stop_reason?: unknown;
			stopReason?: unknown;
			message?: { content?: unknown };
		}>;
		finish_reason?: unknown;
		finishReason?: unknown;
		stop_reason?: unknown;
		stopReason?: unknown;
	};
	const stopReason =
		extractStopReasonFromChoice(response.choices?.[0]) ??
		(typeof response.finish_reason === "string"
			? response.finish_reason
			: typeof response.finishReason === "string"
				? response.finishReason
				: typeof response.stop_reason === "string"
					? response.stop_reason
					: typeof response.stopReason === "string"
						? response.stopReason
						: null);

	return {
		text: stripThinkingTags(extractTextBlocks(response.choices?.[0]?.message?.content)),
		stopReason,
		truncated: isTruncatedLlmStopReason(stopReason),
	};
}

export function extractLlmText(
	provider: SupportedLlmProvider,
	payload: unknown
): string {
	return extractLlmTextResult(provider, payload).text;
}

export function shouldRetryLlmRequest(status: number): boolean {
	return RETRYABLE_LLM_STATUS_CODES.has(status);
}

export function getLlmRetryDelayMs(
	attemptIndex: number,
	retryAfterHeader?: string | null
): number {
	const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
	if (retryAfterMs !== null) {
		return Math.min(retryAfterMs, LLM_RETRY_MAX_DELAY_MS);
	}
	return Math.min(
		LLM_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, attemptIndex)),
		LLM_RETRY_MAX_DELAY_MS
	);
}

function parseRetryAfterMs(value?: string | null): number | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;

	const seconds = Number(trimmed);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.round(seconds * 1000);
	}

	const retryAt = Date.parse(trimmed);
	if (Number.isNaN(retryAt)) return null;
	return Math.max(0, retryAt - Date.now());
}

function getHeaderValue(headers: unknown, key: string): string | null {
	if (!headers) return null;
	const normalizedKey = key.toLowerCase();

	if (
		typeof headers === "object" &&
		headers !== null &&
		"get" in headers &&
		typeof (headers as { get?: unknown }).get === "function"
	) {
		const value = (headers as { get: (name: string) => string | null }).get(normalizedKey);
		return typeof value === "string" ? value : null;
	}

	if (typeof headers !== "object" || headers === null) return null;
	for (const headerName in headers as Record<string, unknown>) {
		const headerValue = (headers as Record<string, unknown>)[headerName];
		if (headerName.toLowerCase() !== normalizedKey) continue;
		return typeof headerValue === "string" ? headerValue : null;
	}

	return null;
}

function shouldRetryLlmError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.toLowerCase();
	return [
		"timeout",
		"timed out",
		"network",
		"econnreset",
		"econnrefused",
		"socket hang up",
		"fetch failed",
		"temporarily unavailable",
	].some((token) => normalized.includes(token));
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) {
		signal?.throwIfAborted();
		return;
	}

	await new Promise<void>((resolve, reject) => {
		const timer = window.setTimeout(() => {
			cleanup();
			resolve();
		}, ms);

		const onAbort = () => {
			window.clearTimeout(timer);
			cleanup();
			reject(new DOMException("Aborted", "AbortError"));
		};

		const cleanup = () => {
			signal?.removeEventListener("abort", onAbort);
		};

		if (signal?.aborted) {
			onAbort();
			return;
		}

		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

async function requestLlm(
	request: LlmRequestDescriptor,
	signal?: AbortSignal
): Promise<LlmResponse> {
	const fetchPromise = requestUrl({
		url: request.url,
		method: "POST",
		headers: request.headers,
		body: JSON.stringify(request.body),
		throw: false,
	});

	return signal
		? await Promise.race([
				fetchPromise,
				new Promise<never>((_, reject) => {
					if (signal.aborted) {
						reject(new DOMException("Aborted", "AbortError"));
						return;
					}
					signal.addEventListener(
						"abort",
						() => reject(new DOMException("Aborted", "AbortError")),
						{ once: true }
					);
				}),
		  ])
		: await fetchPromise;
}

export function parseHighlights(
	jsonStr: string,
	pageNum: number,
	sectionTag: SectionTag,
	headingText?: string
): HighlightResult[] {
	try {
		const parsed = JSON.parse(jsonStr) as { highlights?: unknown[] };
		if (!Array.isArray(parsed.highlights)) return [];
		return parsed.highlights
			.filter(
				(h): h is { exact_text: string; type: string } =>
					typeof (h as Record<string, unknown>).exact_text === "string" &&
					(h as Record<string, unknown>).exact_text !== "" &&
					typeof (h as Record<string, unknown>).type === "string"
			)
			.filter((h) => {
				// Light post-processing: skip obviously truncated fragments
				const t = h.exact_text.trim();
				// Too short to be useful (< 10 chars)
				if (t.length < 10) return false;
				return true;
			})
			.map((h) => ({
				exact_text: h.exact_text,
				type: h.type,
				pageNum,
				sectionTag,
				headingText,
			}));
	} catch {
		return [];
	}
}

export async function callLlmTextWithMeta(
	config: LlmConfig,
	systemPrompt: string,
	userContent: string,
	signal?: AbortSignal,
	options: LlmRequestOptions = {}
): Promise<LlmTextResult> {
	if (!systemPrompt) {
		return {
			text: "{}",
			stopReason: null,
			truncated: false,
		};
	}
	signal?.throwIfAborted();

	const request = buildLlmRequest(config, systemPrompt, userContent, options);
	const concurrencyManager = getSharedLlmConcurrencyManager(config.concurrencyLimit);
	for (let attempt = 0; attempt < MAX_LLM_RETRY_ATTEMPTS; attempt++) {
		signal?.throwIfAborted();
		let llmError: LlmApiErrorLike | null = null;
		try {
			const resp = await concurrencyManager.schedule(
				async () => {
					const requestStartedAt = Date.now();
					try {
						const response = await requestLlm(request, signal);
						if (response.status === 200) {
							concurrencyManager.recordSuccess(Date.now() - requestStartedAt);
							return response;
						}

						llmError = parseLlmErrorResponse(request, response);
						concurrencyManager.recordFailure(llmError);
						return response;
					} catch (error) {
						if (error instanceof DOMException && error.name === "AbortError") {
							throw error;
						}

						llmError = normalizeThrownLlmError(error, request.provider);
						concurrencyManager.recordFailure(llmError);
						throw llmError;
					}
				},
				{ signal, maxConcurrency: config.concurrencyLimit }
			);

			if (resp.status === 200) {
				return extractLlmTextResult(request.provider, resp.json);
			}

			const responseError = llmError ?? parseLlmErrorResponse(request, resp);
			if (!responseError.isRetryable || attempt === MAX_LLM_RETRY_ATTEMPTS - 1) {
				throw responseError;
			}

			const retryDelayMs = getRetryDelayForError(attempt, responseError);
			await sleepWithAbort(retryDelayMs, signal);
			continue;
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") {
				throw error;
			}

			const thrownError = llmError ?? normalizeThrownLlmError(error, request.provider);
			if (!thrownError.isRetryable || attempt === MAX_LLM_RETRY_ATTEMPTS - 1) {
				throw thrownError;
			}

			await sleepWithAbort(getRetryDelayForError(attempt, thrownError), signal);
		}
	}

	throw new Error("LLM request failed after retry exhaustion.");
}

export async function callLlmText(
	config: LlmConfig,
	systemPrompt: string,
	userContent: string,
	signal?: AbortSignal,
	options: LlmRequestOptions = {}
): Promise<string> {
	const response = await callLlmTextWithMeta(
		config,
		systemPrompt,
		userContent,
		signal,
		options
	);
	return response.text;
}

export async function callLlm(
	config: LlmConfig,
	systemPrompt: string,
	chunk: TextChunk,
	signal?: AbortSignal
): Promise<HighlightResult[]> {
	if (!systemPrompt) return [];
	const sectionLabel = chunk.headingText || chunk.sectionTag;
	const content = await callLlmText(
		config,
		systemPrompt,
		`Section: ${sectionLabel}\n\n${chunk.text}`,
		signal,
		{ responseMode: "json" }
	);
	return parseHighlights(content, chunk.pageNum, chunk.sectionTag, chunk.headingText);
}
