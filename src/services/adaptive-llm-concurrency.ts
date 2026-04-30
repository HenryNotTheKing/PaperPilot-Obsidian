import type {
	LlmApiErrorLike,
	LlmConcurrencySnapshot,
	LlmOverloadInfo,
} from "../types";

interface ScheduleOptions {
	signal?: AbortSignal;
	maxConcurrency?: number;
}

interface PendingTask<T> {
	operation: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
	started: boolean;
	canceled: boolean;
	cleanup: () => void;
}

const DEFAULT_SHARED_MAX_CONCURRENCY = 3;
const MIN_LLM_CONCURRENCY = 1;
const RECOVERY_SUCCESS_STREAK = 5;
const RECOVERY_ADJUSTMENT_COOLDOWN_MS = 10_000;
const OVERLOAD_COOLDOWN_MS = 15_000;
const OVERLOAD_WINDOW_MS = 60_000;

function clampConcurrency(
	value?: number,
	fallback = DEFAULT_SHARED_MAX_CONCURRENCY
): number {
	if (!Number.isFinite(value)) {
		return Math.max(MIN_LLM_CONCURRENCY, Math.floor(fallback));
	}

	return Math.max(MIN_LLM_CONCURRENCY, Math.floor(value ?? fallback));
}

function createAbortError(): DOMException {
	return new DOMException("Aborted", "AbortError");
}

export class AdaptiveLlmConcurrencyManager {
	private currentConcurrency: number;
	private maxConcurrency: number;
	private activeCount = 0;
	private pendingQueue: PendingTask<unknown>[] = [];
	private lastAdjustmentAt = 0;
	private successStreak = 0;
	private cooldownUntil: number | null = null;
	private overloadHistory: LlmOverloadInfo[] = [];
	private lastOverload: LlmOverloadInfo | null = null;

	constructor(initialMaxConcurrency = DEFAULT_SHARED_MAX_CONCURRENCY) {
		const normalized = clampConcurrency(initialMaxConcurrency);
		this.currentConcurrency = normalized;
		this.maxConcurrency = normalized;
	}

	configure(maxConcurrency?: number): void {
		if (maxConcurrency === undefined) return;

		const normalized = clampConcurrency(maxConcurrency, this.maxConcurrency);
		this.maxConcurrency = normalized;
		if (this.currentConcurrency > normalized) {
			this.currentConcurrency = normalized;
			this.lastAdjustmentAt = Date.now();
		}

		this.drainQueue();
	}

	async schedule<T>(
		operation: () => Promise<T>,
		options: ScheduleOptions = {}
	): Promise<T> {
		this.configure(options.maxConcurrency);
		if (options.signal?.aborted) {
			throw createAbortError();
		}

		return await new Promise<T>((resolve, reject) => {
			const entry: PendingTask<T> = {
				operation,
				resolve,
				reject,
				started: false,
				canceled: false,
				cleanup: () => {},
			};

			const onAbort = () => {
				if (entry.started || entry.canceled) return;
				entry.canceled = true;
				this.pendingQueue = this.pendingQueue.filter(
					(pending) => pending !== (entry as PendingTask<unknown>)
				);
				entry.cleanup();
				reject(createAbortError());
			};

			entry.cleanup = () => {
				options.signal?.removeEventListener("abort", onAbort);
			};

			options.signal?.addEventListener("abort", onAbort, { once: true });
			this.pendingQueue.push(entry as PendingTask<unknown>);
			this.drainQueue();
		});
	}

	recordSuccess(_latencyMs?: number): void {
		this.pruneOverloadHistory();
		this.successStreak += 1;
		const now = Date.now();

		if (this.currentConcurrency >= this.maxConcurrency) return;
		if ((this.cooldownUntil ?? 0) > now) return;
		if (now - this.lastAdjustmentAt < RECOVERY_ADJUSTMENT_COOLDOWN_MS) return;
		if (this.successStreak < RECOVERY_SUCCESS_STREAK) return;

		this.currentConcurrency += 1;
		this.successStreak = 0;
		this.lastAdjustmentAt = now;
		this.drainQueue();
	}

	recordFailure(error?: Partial<LlmApiErrorLike>): void {
		this.successStreak = 0;
		this.pruneOverloadHistory();
		if (!error?.isOverloaded) return;

		const now = Date.now();
		const nextConcurrency = Math.max(
			MIN_LLM_CONCURRENCY,
			Math.floor(this.currentConcurrency / 2)
		);
		this.currentConcurrency = Math.min(
			this.maxConcurrency,
			nextConcurrency || MIN_LLM_CONCURRENCY
		);

		const retryAfterMs = Math.max(0, error.retryAfterMs ?? 0);
		this.cooldownUntil = now + Math.max(OVERLOAD_COOLDOWN_MS, retryAfterMs);

		const overloadInfo: LlmOverloadInfo = {
			at: now,
			status: error.status,
			provider: error.provider,
			requestId: error.requestId,
			errorType: error.errorType,
			message: error.rawMessage ?? error.message ?? "LLM overload",
			retryAfterMs: error.retryAfterMs ?? null,
		};
		this.overloadHistory.push(overloadInfo);
		this.lastOverload = overloadInfo;
		this.lastAdjustmentAt = now;
	}

	getSnapshot(): LlmConcurrencySnapshot {
		this.pruneOverloadHistory();
		return {
			currentConcurrency: this.currentConcurrency,
			maxConcurrency: this.maxConcurrency,
			cooldownUntil:
				this.cooldownUntil && this.cooldownUntil > Date.now()
					? this.cooldownUntil
					: null,
			recentOverloadCount: this.overloadHistory.length,
			activeCount: this.activeCount,
			pendingCount: this.pendingQueue.filter((entry) => !entry.canceled).length,
			lastOverload: this.lastOverload,
		};
	}

	reset(maxConcurrency = this.maxConcurrency): void {
		const normalized = clampConcurrency(maxConcurrency, this.maxConcurrency);
		this.currentConcurrency = normalized;
		this.maxConcurrency = normalized;
		this.activeCount = 0;
		this.pendingQueue = [];
		this.lastAdjustmentAt = 0;
		this.successStreak = 0;
		this.cooldownUntil = null;
		this.overloadHistory = [];
		this.lastOverload = null;
	}

	private drainQueue(): void {
		while (
			this.activeCount < this.currentConcurrency &&
			this.pendingQueue.length > 0
		) {
			const nextEntry = this.pendingQueue.shift();
			if (!nextEntry) continue;
			if (nextEntry.canceled) {
				nextEntry.cleanup();
				continue;
			}

			this.startEntry(nextEntry);
		}
	}

	private startEntry<T>(entry: PendingTask<T>): void {
		entry.started = true;
		entry.cleanup();
		this.activeCount += 1;

		void entry
			.operation()
			.then((value) => entry.resolve(value))
			.catch((error) => entry.reject(error))
			.finally(() => {
				this.activeCount = Math.max(0, this.activeCount - 1);
				this.drainQueue();
			});
	}

	private pruneOverloadHistory(): void {
		const cutoff = Date.now() - OVERLOAD_WINDOW_MS;
		this.overloadHistory = this.overloadHistory.filter(
			(overload) => overload.at >= cutoff
		);

		if (this.cooldownUntil !== null && this.cooldownUntil <= Date.now()) {
			this.cooldownUntil = null;
		}

		if (this.lastOverload && this.lastOverload.at < cutoff) {
			this.lastOverload =
				this.overloadHistory[this.overloadHistory.length - 1] ?? null;
		}
	}
}

let sharedLlmConcurrencyManager: AdaptiveLlmConcurrencyManager | null = null;

export function getSharedLlmConcurrencyManager(
	maxConcurrency?: number
): AdaptiveLlmConcurrencyManager {
	if (!sharedLlmConcurrencyManager) {
		sharedLlmConcurrencyManager = new AdaptiveLlmConcurrencyManager(
			maxConcurrency ?? DEFAULT_SHARED_MAX_CONCURRENCY
		);
	}

	if (maxConcurrency !== undefined) {
		sharedLlmConcurrencyManager.configure(maxConcurrency);
	}

	return sharedLlmConcurrencyManager;
}

export function resetSharedLlmConcurrencyManager(
	maxConcurrency = DEFAULT_SHARED_MAX_CONCURRENCY
): void {
	sharedLlmConcurrencyManager = new AdaptiveLlmConcurrencyManager(maxConcurrency);
}