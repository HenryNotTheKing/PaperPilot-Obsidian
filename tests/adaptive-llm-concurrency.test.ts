import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdaptiveLlmConcurrencyManager } from "../src/services/adaptive-llm-concurrency";

describe("AdaptiveLlmConcurrencyManager", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-21T00:00:00.000Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shrinks on overload and recovers gradually after stable success", () => {
		const manager = new AdaptiveLlmConcurrencyManager(3);
		expect(manager.getSnapshot().currentConcurrency).toBe(3);

		manager.recordFailure({
			status: 529,
			rawMessage: "overloaded error (529)",
			isRetryable: true,
			isOverloaded: true,
		});

		expect(manager.getSnapshot().currentConcurrency).toBe(1);
		expect(manager.getSnapshot().recentOverloadCount).toBe(1);

		for (let index = 0; index < 5; index++) {
			manager.recordSuccess();
		}
		expect(manager.getSnapshot().currentConcurrency).toBe(1);

		vi.advanceTimersByTime(15_000);
		for (let index = 0; index < 5; index++) {
			manager.recordSuccess();
		}
		expect(manager.getSnapshot().currentConcurrency).toBe(2);

		vi.advanceTimersByTime(10_000);
		for (let index = 0; index < 5; index++) {
			manager.recordSuccess();
		}
		expect(manager.getSnapshot().currentConcurrency).toBe(3);
	});
});