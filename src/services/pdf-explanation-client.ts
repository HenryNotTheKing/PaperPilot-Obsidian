import { buildLlmRequest, resolveLlmProvider } from "./llm-client";
import type { LlmConfig } from "../types";

export interface StreamCallbacks {
	onToken: (token: string) => void;
	onDone: () => void;
	onError: (error: Error) => void;
}

interface OpenAiStreamChunk {
	choices?: Array<{
		delta?: { content?: string };
	}>;
}

interface AnthropicStreamChunk {
	type?: string;
	delta?: { text?: string };
}

function extractTokenFromLine(
	provider: "openai" | "anthropic",
	line: string
): string | null {
	if (!line.startsWith("data: ")) return null;
	const data = line.slice(6).trim();
	if (data === "[DONE]") return null;
	try {
		const parsed = JSON.parse(data) as Record<string, unknown>;
		if (provider === "openai") {
			const chunk = parsed as OpenAiStreamChunk;
			return chunk.choices?.[0]?.delta?.content ?? null;
		} else {
			const chunk = parsed as AnthropicStreamChunk;
			if (chunk.type === "content_block_delta") {
				return chunk.delta?.text ?? null;
			}
			return null;
		}
	} catch {
		return null;
	}
}

export async function callLlmStream(
	config: LlmConfig,
	systemPrompt: string,
	userContent: string,
	callbacks: StreamCallbacks,
	signal?: AbortSignal
): Promise<void> {
	const provider = resolveLlmProvider(config);
	const request = buildLlmRequest(config, systemPrompt, userContent, {
		temperature: 0.3,
		maxTokens: 2048,
		responseMode: "text",
	});

	// Inject stream flag into request body
	const body = { ...request.body, stream: true };

	let response: Response;
	try {
		// eslint-disable-next-line no-restricted-globals
		response = await fetch(request.url, {
			method: "POST",
			headers: request.headers,
			body: JSON.stringify(body),
			signal,
		});
	} catch (error) {
		callbacks.onError(
			error instanceof Error ? error : new Error(String(error))
		);
		return;
	}

	if (!response.ok) {
		const text = await response.text().catch(() => "Unknown error");
		callbacks.onError(new Error(`LLM request failed: ${response.status} ${text}`));
		return;
	}

	if (!response.body) {
		callbacks.onError(new Error("Response body is empty"));
		return;
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			if (signal?.aborted) {
				await reader.cancel();
				throw new DOMException("Aborted", "AbortError");
			}

			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const token = extractTokenFromLine(provider, line);
				if (token !== null) {
					callbacks.onToken(token);
				}
			}
		}

		// Process remaining buffer
		if (buffer.trim()) {
			for (const line of buffer.split("\n")) {
				const token = extractTokenFromLine(provider, line);
				if (token !== null) {
					callbacks.onToken(token);
				}
			}
		}

		callbacks.onDone();
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return;
		}
		callbacks.onError(
			error instanceof Error ? error : new Error(String(error))
		);
	} finally {
		reader.releaseLock();
	}
}
