import type { TextChunk } from "../types";
import type { PaperAnalyzerSettings } from "../settings";

const EXTRACTION_OUTPUT_GUARD = {
	en: "Do not output chain-of-thought, explanations, or <think> tags. Return the final JSON immediately.",
	zh: "不要输出思考过程、解释性文字或 <think> 标签。直接返回最终 JSON。",
};

export function getPromptForChunk(
	_chunk: TextChunk,
	settings: PaperAnalyzerSettings
): string {
	const guard = settings.language === "zh-CN"
		? EXTRACTION_OUTPUT_GUARD.zh
		: EXTRACTION_OUTPUT_GUARD.en;
	return `${settings.extractionPrompt.trim()}\n\n${guard}`;
}

export async function runConcurrent<T>(
	tasks: Array<() => Promise<T>>,
	concurrency: number,
	signal?: AbortSignal
): Promise<T[]> {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	const results: T[] = new Array(tasks.length);
	let index = 0;

	async function worker() {
		while (index < tasks.length) {
			signal?.throwIfAborted();
			const taskIndex = index++;
			const task = tasks[taskIndex];
			if (task) {
				results[taskIndex] = await task();
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
	return results;
}
