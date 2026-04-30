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

export class PluginSettingTab {
	app: unknown;
	plugin: unknown;
	containerEl: { empty: () => void; createEl: (...args: unknown[]) => unknown } = {
		empty: () => {},
		createEl: () => ({}),
	};
	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
	}
	display(): void {}
	hide(): void {}
}

export class Setting {
	constructor(_containerEl: unknown) {}
	setName() { return this; }
	setDesc() { return this; }
	setHeading() { return this; }
	addText() { return this; }
	addTextArea() { return this; }
	addDropdown() { return this; }
	addToggle() { return this; }
	addButton() { return this; }
	addSlider() { return this; }
	addExtraButton() { return this; }
}
