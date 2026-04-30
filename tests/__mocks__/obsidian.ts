import { vi } from "vitest";

// Mock module for `obsidian` during unit tests.

export const requestUrl = vi.fn((): never => {
	throw new Error("requestUrl is not available in unit tests");
});

export class TFile {
	path = "";
	name = "";
	basename = "";
	extension = "";
}

export class Notice {
	constructor(_msg: string, _duration?: number) {}
}
