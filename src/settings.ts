import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import {
	DEFAULT_ARXIV_FIELD_ALIASES,
	DEFAULT_DOI_FIELD_ALIASES,
	DEFAULT_EXTRACTION_PROMPT,
	DEFAULT_TYPE_COLOR_MAP,
	CitationSidebarSettings,
	getDefaultSummaryPrompt,
	type LlmProvider,
	type SummaryEffort,
	normalizeCitationFieldAliases,
	normalizeLlmProvider,
	normalizeSummaryEffort,
} from "./types";
import type { StoredHighlight } from "./types";
import type PaperAnalyzerPlugin from "./main";
import { DEFAULT_PAPER_NOTE_TEMPLATE } from "./services/arxiv-client";
import { t, setLocale, getLocale, getTranslations, type LocaleId } from "./i18n";

export type DuplicateImportAction = "ask" | "reuse" | "overwrite";

export function normalizeDuplicateImportAction(
	value: unknown,
	fallback: DuplicateImportAction = "ask"
): DuplicateImportAction {
	if (value === "ask" || value === "reuse" || value === "overwrite") {
		return value;
	}
	return fallback;
}

export interface PaperAnalyzerSettings {
	language: LocaleId;
	attachmentFolderPath: string;
	notesFolderPath: string;
	existingPdfAction: DuplicateImportAction;
	existingNoteAction: DuplicateImportAction;
	paperNoteTemplate: string;

	extractionBaseUrl: string;
	extractionApiKey: string;
	extractionModel: string;
	extractionProvider: LlmProvider;

	summaryBaseUrl: string;
	summaryApiKey: string;
	summaryModel: string;
	summaryProvider: LlmProvider;
	huggingFaceUserId: string;
	huggingFaceApiKey: string;
	preferHuggingFacePaperMarkdown: boolean;
	highEffortReviewEnabled: boolean;

	extractionPrompt: string;
	autoSummarizeAfterImport: boolean;
	defaultSummaryEffort: SummaryEffort;
	summaryLowPrompt: string;
	summaryMediumPrompt: string;
	summaryHighPrompt: string;
	summaryExtreamPrompt: string;
	summaryLowPromptZh: string;
	summaryMediumPromptZh: string;
	summaryHighPromptZh: string;
	summaryExtreamPromptZh: string;
	typeColorMap: Record<string, string>;
	highlightOpacity: number;
	useColorHighlights: boolean;
	llmConcurrency: number;
	autoAnalyzeAfterImport: boolean;
	analyzeQueue: import("./types").QueueItem[];
	summaryQueue: import("./types").SummaryQueueItem[];
	citationSidebar: CitationSidebarSettings;
	/** Persisted highlight data keyed by PDF vault path */
	highlights: Record<string, StoredHighlight[]>;
}

export const DEFAULT_SETTINGS: PaperAnalyzerSettings = {
	language: "en",
	attachmentFolderPath: "Papers/PDFs",
	notesFolderPath: "Papers/Notes",
	existingPdfAction: "ask",
	existingNoteAction: "ask",
	paperNoteTemplate: DEFAULT_PAPER_NOTE_TEMPLATE,

	extractionBaseUrl: "https://api.siliconflow.cn/v1",
	extractionApiKey: "",
	extractionModel: "Qwen/Qwen3-8B",
	extractionProvider: "auto",

	summaryBaseUrl: "https://api.siliconflow.cn/v1",
	summaryApiKey: "",
	summaryModel: "Qwen/Qwen3-8B",
	summaryProvider: "auto",
	huggingFaceUserId: "",
	huggingFaceApiKey: "",
	preferHuggingFacePaperMarkdown: true,
	highEffortReviewEnabled: true,

	extractionPrompt: DEFAULT_EXTRACTION_PROMPT,
	autoSummarizeAfterImport: false,
	defaultSummaryEffort: "medium",
	summaryLowPrompt: getDefaultSummaryPrompt("en", "low"),
	summaryMediumPrompt: getDefaultSummaryPrompt("en", "medium"),
	summaryHighPrompt: getDefaultSummaryPrompt("en", "high"),
	summaryExtreamPrompt: getDefaultSummaryPrompt("en", "extream"),
	summaryLowPromptZh: getDefaultSummaryPrompt("zh-CN", "low"),
	summaryMediumPromptZh: getDefaultSummaryPrompt("zh-CN", "medium"),
	summaryHighPromptZh: getDefaultSummaryPrompt("zh-CN", "high"),
	summaryExtreamPromptZh: getDefaultSummaryPrompt("zh-CN", "extream"),
	typeColorMap: { ...DEFAULT_TYPE_COLOR_MAP },
	highlightOpacity: 0.84,
	useColorHighlights: true,
	llmConcurrency: 3,
	autoAnalyzeAfterImport: false,
	analyzeQueue: [],
	summaryQueue: [],
	highlights: {},
	citationSidebar: {
		enabled: true,
		maxResults: 20,
		minSimilarity: 0.05,
		semanticScholarApiKey: "",
		arxivFieldAliases: [...DEFAULT_ARXIV_FIELD_ALIASES],
		doiFieldAliases: [...DEFAULT_DOI_FIELD_ALIASES],
	},
};

function formatFieldAliases(fieldAliases: string[]): string {
	return fieldAliases.join(", ");
}

function parseFieldAliasInput(value: string, fallback: string[]): string[] {
	return normalizeCitationFieldAliases(
		value
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean),
		fallback
	);
}

function formatQueueWorkers(
	language: LocaleId,
	activeWorkers?: number,
	pendingWorkers?: number
): string {
	if (
		typeof activeWorkers !== "number" &&
		typeof pendingWorkers !== "number"
	) {
		return "";
	}

	const active = activeWorkers ?? 0;
	const total = active + (pendingWorkers ?? 0);
	return language === "zh-CN"
		? `工作线程 ${active}/${total}`
		: `Workers ${active}/${total}`;
}

function getSummaryPromptForCurrentLanguage(
	settings: PaperAnalyzerSettings,
	effort: SummaryEffort
): string {
	if (settings.language === "zh-CN") {
		switch (effort) {
			case "low":
				return settings.summaryLowPromptZh;
			case "extream":
				return settings.summaryExtreamPromptZh;
			case "high":
				return settings.summaryHighPromptZh;
			case "medium":
			default:
				return settings.summaryMediumPromptZh;
		}
	}

	switch (effort) {
		case "low":
			return settings.summaryLowPrompt;
		case "extream":
			return settings.summaryExtreamPrompt;
		case "high":
			return settings.summaryHighPrompt;
		case "medium":
		default:
			return settings.summaryMediumPrompt;
	}
}

function setSummaryPromptForCurrentLanguage(
	settings: PaperAnalyzerSettings,
	effort: SummaryEffort,
	value: string
): void {
	if (settings.language === "zh-CN") {
		switch (effort) {
			case "low":
				settings.summaryLowPromptZh = value;
				return;
			case "extream":
				settings.summaryExtreamPromptZh = value;
				return;
			case "high":
				settings.summaryHighPromptZh = value;
				return;
			case "medium":
			default:
				settings.summaryMediumPromptZh = value;
				return;
		}
	}

	switch (effort) {
		case "low":
			settings.summaryLowPrompt = value;
			return;
		case "extream":
			settings.summaryExtreamPrompt = value;
			return;
		case "high":
			settings.summaryHighPrompt = value;
			return;
		case "medium":
		default:
			settings.summaryMediumPrompt = value;
	}
}

export class PaperAnalyzerSettingTab extends PluginSettingTab {
	plugin: PaperAnalyzerPlugin;
	private analysisQueueSectionEl: HTMLElement | null = null;
	private summaryQueueSectionEl: HTMLElement | null = null;

	constructor(app: App, plugin: PaperAnalyzerPlugin) {
		super(app, plugin);
		this.plugin = plugin; // must be set before registerEvent
		this.plugin.registerEvent(
			this.app.workspace.on("paper-analyzer:queue-update", () => {
				this.renderQueueSection();
			})
		);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("paper-analyzer-settings-panel");

		// --- Queue overview ---
		const queueOverviewEl = containerEl.createDiv({
			cls: "paper-analyzer-queue-overview",
		});
		this.analysisQueueSectionEl = queueOverviewEl.createDiv({
			cls: "paper-analyzer-queue-section",
		});
		this.summaryQueueSectionEl = queueOverviewEl.createDiv({
			cls: "paper-analyzer-queue-section",
		});
		this.renderQueueSection();

		// --- Language ---
		new Setting(containerEl)
			.setName(t("settings.language"))
			.setDesc(t("settings.languageDesc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("en", "English")
					.addOption("zh-CN", "中文")
					.setValue(getLocale())
					.onChange(async (value) => {
						setLocale(value as LocaleId);
						this.plugin.settings.language = value as LocaleId;
						await this.plugin.saveSettings();
						this.plugin.refreshI18n();
						this.display();
					})
			);

		// --- File Paths ---
		new Setting(containerEl).setName(t("settings.filePaths")).setHeading();

		new Setting(containerEl)
			.setName(t("settings.attachmentFolder"))
			.setDesc(t("settings.attachmentFolderDesc"))
			.addText((text) =>
				text
					.setPlaceholder(t("settings.attachmentFolderPlaceholder"))
					.setValue(this.plugin.settings.attachmentFolderPath)
					.onChange(async (value) => {
						this.plugin.settings.attachmentFolderPath = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.notesFolder"))
			.setDesc(t("settings.notesFolderDesc"))
			.addText((text) =>
				text
					.setPlaceholder(t("settings.notesFolderPlaceholder"))
					.setValue(this.plugin.settings.notesFolderPath)
					.onChange(async (value) => {
						this.plugin.settings.notesFolderPath = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.duplicateHandling"))
			.setHeading();

		new Setting(containerEl)
			.setName(t("settings.existingPdfAction"))
			.setDesc(t("settings.existingPdfActionDesc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("ask", t("settings.duplicateActionAsk"))
					.addOption("reuse", t("settings.duplicateActionReuse"))
					.addOption("overwrite", t("settings.duplicateActionOverwrite"))
					.setValue(this.plugin.settings.existingPdfAction)
					.onChange(async (value) => {
						this.plugin.settings.existingPdfAction =
							normalizeDuplicateImportAction(value, DEFAULT_SETTINGS.existingPdfAction);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.existingNoteAction"))
			.setDesc(t("settings.existingNoteActionDesc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("ask", t("settings.duplicateActionAsk"))
					.addOption("reuse", t("settings.duplicateActionReuse"))
					.addOption("overwrite", t("settings.duplicateActionOverwrite"))
					.setValue(this.plugin.settings.existingNoteAction)
					.onChange(async (value) => {
						this.plugin.settings.existingNoteAction =
							normalizeDuplicateImportAction(value, DEFAULT_SETTINGS.existingNoteAction);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName(t("settings.paperNoteTemplate")).setHeading();
		containerEl.createEl("p", {
			text: t("settings.paperNoteTemplateDesc"),
			cls: "setting-item-description",
		});

		const paperNoteTemplateSetting = new Setting(containerEl)
			.setName(t("settings.paperNoteTemplateFieldName"))
			.setDesc(t("settings.paperNoteTemplateHelp"))
			.addTextArea((ta) => {
				ta.setValue(this.plugin.settings.paperNoteTemplate)
					.onChange(async (value) => {
						this.plugin.settings.paperNoteTemplate = value;
						await this.plugin.saveSettings();
					});
				ta.inputEl.rows = 12;
				ta.inputEl.addClass("paper-analyzer-prompt-textarea");
			})
			.addButton((btn) =>
				btn.setButtonText(t("settings.restoreDefault")).onClick(async () => {
					this.plugin.settings.paperNoteTemplate = DEFAULT_PAPER_NOTE_TEMPLATE;
					await this.plugin.saveSettings();
					this.display();
				})
			);
		paperNoteTemplateSetting.settingEl.addClass("paper-analyzer-textarea-setting");

		// --- Extraction Model ---
		new Setting(containerEl).setName(t("settings.extractionModel")).setHeading();
		containerEl.createEl("p", {
			text: t("settings.extractionModelDesc"),
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName(t("settings.baseUrl"))
			.setDesc(t("settings.baseUrlDesc"))
			.addText((text) =>
				text
					.setPlaceholder("https://api.siliconflow.cn/v1")
					.setValue(this.plugin.settings.extractionBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.extractionBaseUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.provider"))
			.setDesc(t("settings.providerDesc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("auto", t("settings.providerAuto"))
					.addOption("openai", t("settings.providerOpenAI"))
					.addOption("anthropic", t("settings.providerAnthropic"))
					.setValue(this.plugin.settings.extractionProvider)
					.onChange(async (value) => {
						this.plugin.settings.extractionProvider = normalizeLlmProvider(
							value,
							DEFAULT_SETTINGS.extractionProvider
						);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName(t("settings.apiKey")).addText((text) => {
			text
				.setPlaceholder(t("settings.apiKeyPlaceholder"))
				.setValue(this.plugin.settings.extractionApiKey)
				.onChange(async (value) => {
					this.plugin.settings.extractionApiKey = value.trim();
					await this.plugin.saveSettings();
				});
			text.inputEl.type = "password";
		});

		new Setting(containerEl)
			.setName(t("settings.model"))
			.setDesc(t("settings.modelPlaceholder"))
			.addText((text) =>
				text
					.setPlaceholder(t("settings.modelPlaceholder"))
					.setValue(this.plugin.settings.extractionModel)
					.onChange(async (value) => {
						this.plugin.settings.extractionModel = value.trim();
						await this.plugin.saveSettings();
					})
			);

		// --- Summary Model ---
		new Setting(containerEl).setName(t("settings.summaryModel")).setHeading();
		containerEl.createEl("p", {
			text: t("settings.summaryModelDesc"),
			cls: "setting-item-description",
		});

		new Setting(containerEl).setName(t("settings.baseUrl")).addText((text) =>
			text
				.setPlaceholder("https://api.siliconflow.cn/v1")
				.setValue(this.plugin.settings.summaryBaseUrl)
				.onChange(async (value) => {
					this.plugin.settings.summaryBaseUrl = value.trim();
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl)
			.setName(t("settings.provider"))
			.setDesc(t("settings.providerDesc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("auto", t("settings.providerAuto"))
					.addOption("openai", t("settings.providerOpenAI"))
					.addOption("anthropic", t("settings.providerAnthropic"))
					.setValue(this.plugin.settings.summaryProvider)
					.onChange(async (value) => {
						this.plugin.settings.summaryProvider = normalizeLlmProvider(
							value,
							DEFAULT_SETTINGS.summaryProvider
						);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName(t("settings.apiKey")).addText((text) => {
			text
				.setPlaceholder(t("settings.apiKeyPlaceholder"))
				.setValue(this.plugin.settings.summaryApiKey)
				.onChange(async (value) => {
					this.plugin.settings.summaryApiKey = value.trim();
					await this.plugin.saveSettings();
				});
			text.inputEl.type = "password";
		});

		new Setting(containerEl).setName(t("settings.model")).addText((text) =>
			text
				.setPlaceholder(t("settings.modelPlaceholder"))
				.setValue(this.plugin.settings.summaryModel)
				.onChange(async (value) => {
					this.plugin.settings.summaryModel = value.trim();
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl)
			.setName(t("settings.llmConcurrency"))
			.setDesc(t("settings.llmConcurrencyDesc"))
			.addSlider((slider) =>
				slider
					.setLimits(1, 10, 1)
					.setValue(this.plugin.settings.llmConcurrency)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.llmConcurrency = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName(t("settings.huggingFace")).setHeading();
		containerEl.createEl("p", {
			text: t("settings.huggingFaceDesc"),
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName(t("settings.huggingFaceUserId"))
			.setDesc(t("settings.huggingFaceUserIdDesc"))
			.addText((text) =>
				text
					.setPlaceholder(t("settings.huggingFaceUserIdPlaceholder"))
					.setValue(this.plugin.settings.huggingFaceUserId)
					.onChange(async (value) => {
						this.plugin.settings.huggingFaceUserId = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.huggingFaceApiKey"))
			.setDesc(t("settings.huggingFaceApiKeyDesc"))
			.addText((text) => {
				text
					.setPlaceholder(t("settings.huggingFaceApiKeyPlaceholder"))
					.setValue(this.plugin.settings.huggingFaceApiKey)
					.onChange(async (value) => {
						this.plugin.settings.huggingFaceApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(containerEl)
			.setName(t("settings.preferHuggingFaceMarkdown"))
			.setDesc(t("settings.preferHuggingFaceMarkdownDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.preferHuggingFacePaperMarkdown)
					.onChange(async (value) => {
						this.plugin.settings.preferHuggingFacePaperMarkdown = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName(t("settings.summaryGeneration")).setHeading();
		containerEl.createEl("p", {
			text: t("settings.summaryGenerationDesc"),
			cls: "setting-item-description",
		});

		new Setting(containerEl)
			.setName(t("settings.autoAnalyzeAfterImport"))
			.setDesc(t("settings.autoAnalyzeAfterImportDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoAnalyzeAfterImport)
					.onChange(async (value) => {
						this.plugin.settings.autoAnalyzeAfterImport = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.autoSummarizeAfterImport"))
			.setDesc(t("settings.autoSummarizeAfterImportDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoSummarizeAfterImport)
					.onChange(async (value) => {
						this.plugin.settings.autoSummarizeAfterImport = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.defaultSummaryEffort"))
			.setDesc(t("settings.defaultSummaryEffortDesc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOption("low", t("settings.summaryEffortLow"))
					.addOption("medium", t("settings.summaryEffortMedium"))
					.addOption("high", t("settings.summaryEffortHigh"))
					.addOption("extream", t("settings.summaryEffortExtream"))
					.setValue(this.plugin.settings.defaultSummaryEffort)
					.onChange(async (value) => {
						this.plugin.settings.defaultSummaryEffort = normalizeSummaryEffort(
							value,
							DEFAULT_SETTINGS.defaultSummaryEffort
						);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.highEffortReview"))
			.setDesc(t("settings.highEffortReviewDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.highEffortReviewEnabled)
					.onChange(async (value) => {
						this.plugin.settings.highEffortReviewEnabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName(t("settings.summaryPrompts")).setHeading();
		containerEl.createEl("p", {
			text: t("settings.summaryPromptsDesc"),
			cls: "setting-item-description",
		});

		const summaryLowPromptSetting = new Setting(containerEl)
			.setName(t("settings.summaryLowPrompt"))
			.setDesc(t("settings.summaryLowPromptDesc"))
			.addTextArea((ta) => {
				ta.setValue(getSummaryPromptForCurrentLanguage(this.plugin.settings, "low"))
					.onChange(async (value) => {
						setSummaryPromptForCurrentLanguage(this.plugin.settings, "low", value);
						await this.plugin.saveSettings();
					});
				ta.inputEl.rows = 8;
				ta.inputEl.addClass("paper-analyzer-prompt-textarea");
			})
			.addButton((btn) =>
				btn.setButtonText(t("settings.restoreDefault")).onClick(async () => {
					setSummaryPromptForCurrentLanguage(
						this.plugin.settings,
						"low",
						getDefaultSummaryPrompt(this.plugin.settings.language, "low")
					);
					await this.plugin.saveSettings();
					this.display();
				})
			);
		summaryLowPromptSetting.settingEl.addClass("paper-analyzer-textarea-setting");

		const summaryMediumPromptSetting = new Setting(containerEl)
			.setName(t("settings.summaryMediumPrompt"))
			.setDesc(t("settings.summaryMediumPromptDesc"))
			.addTextArea((ta) => {
				ta.setValue(getSummaryPromptForCurrentLanguage(this.plugin.settings, "medium"))
					.onChange(async (value) => {
						setSummaryPromptForCurrentLanguage(this.plugin.settings, "medium", value);
						await this.plugin.saveSettings();
					});
				ta.inputEl.rows = 10;
				ta.inputEl.addClass("paper-analyzer-prompt-textarea");
			})
			.addButton((btn) =>
				btn.setButtonText(t("settings.restoreDefault")).onClick(async () => {
					setSummaryPromptForCurrentLanguage(
						this.plugin.settings,
						"medium",
						getDefaultSummaryPrompt(this.plugin.settings.language, "medium")
					);
					await this.plugin.saveSettings();
					this.display();
				})
			);
		summaryMediumPromptSetting.settingEl.addClass(
			"paper-analyzer-textarea-setting"
		);

		const summaryHighPromptSetting = new Setting(containerEl)
			.setName(t("settings.summaryHighPrompt"))
			.setDesc(t("settings.summaryHighPromptDesc"))
			.addTextArea((ta) => {
				ta.setValue(getSummaryPromptForCurrentLanguage(this.plugin.settings, "high"))
					.onChange(async (value) => {
						setSummaryPromptForCurrentLanguage(this.plugin.settings, "high", value);
						await this.plugin.saveSettings();
					});
				ta.inputEl.rows = 12;
				ta.inputEl.addClass("paper-analyzer-prompt-textarea");
			})
			.addButton((btn) =>
				btn.setButtonText(t("settings.restoreDefault")).onClick(async () => {
					setSummaryPromptForCurrentLanguage(
						this.plugin.settings,
						"high",
						getDefaultSummaryPrompt(this.plugin.settings.language, "high")
					);
					await this.plugin.saveSettings();
					this.display();
				})
			);
		summaryHighPromptSetting.settingEl.addClass("paper-analyzer-textarea-setting");

		const summaryExtreamPromptSetting = new Setting(containerEl)
			.setName(t("settings.summaryExtreamPrompt"))
			.setDesc(t("settings.summaryExtreamPromptDesc"))
			.addTextArea((ta) => {
				ta.setValue(getSummaryPromptForCurrentLanguage(this.plugin.settings, "extream"))
					.onChange(async (value) => {
						setSummaryPromptForCurrentLanguage(
							this.plugin.settings,
							"extream",
							value
						);
						await this.plugin.saveSettings();
					});
				ta.inputEl.rows = 12;
				ta.inputEl.addClass("paper-analyzer-prompt-textarea");
			})
			.addButton((btn) =>
				btn.setButtonText(t("settings.restoreDefault")).onClick(async () => {
					setSummaryPromptForCurrentLanguage(
						this.plugin.settings,
						"extream",
						getDefaultSummaryPrompt(this.plugin.settings.language, "extream")
					);
					await this.plugin.saveSettings();
					this.display();
				})
			);
		summaryExtreamPromptSetting.settingEl.addClass(
			"paper-analyzer-textarea-setting"
		);

		// --- Extraction Prompt ---
		new Setting(containerEl).setName(t("settings.extractionPrompt")).setHeading();
		containerEl.createEl("p", {
			text: t("settings.promptDesc"),
			cls: "setting-item-description",
		});

		const extractionPromptSetting = new Setting(containerEl)
			.setName(t("settings.promptFieldName"))
			.setDesc(t("settings.promptRestoreDesc"))
			.addTextArea((ta) => {
				ta.setValue(this.plugin.settings.extractionPrompt)
					.onChange(async (value) => {
						this.plugin.settings.extractionPrompt = value;
						await this.plugin.saveSettings();
					});
				ta.inputEl.rows = 10;
				ta.inputEl.addClass("paper-analyzer-prompt-textarea");
			})
			.addButton((btn) =>
				btn.setButtonText(t("settings.restoreDefault")).onClick(async () => {
					this.plugin.settings.extractionPrompt =
						getTranslations().systemPrompt.extractionPrompt;
					await this.plugin.saveSettings();
					this.display();
				})
			);
		extractionPromptSetting.settingEl.addClass("paper-analyzer-textarea-setting");

		new Setting(containerEl)
			.setName(t("settings.highlightColors"))
			.setDesc(t("settings.highlightColorsDesc"))
			.addButton((btn) =>
				btn.setButtonText(t("settings.resetHighlightColors")).onClick(async () => {
					this.plugin.settings.typeColorMap = { ...DEFAULT_TYPE_COLOR_MAP };
					await this.plugin.saveSettings();
					this.plugin.rerenderPdfHighlights();
					this.display();
				})
			);

		this.addHighlightColorSetting(
			containerEl,
			"motivation",
			t("settings.motivationColor"),
			t("settings.motivationColorDesc")
		);
		this.addHighlightColorSetting(
			containerEl,
			"key_step",
			t("settings.keyStepColor"),
			t("settings.keyStepColorDesc")
		);
		this.addHighlightColorSetting(
			containerEl,
			"contribution",
			t("settings.contributionColor"),
			t("settings.contributionColorDesc")
		);

		new Setting(containerEl)
			.setName(t("settings.highlightOpacity"))
			.setDesc(t("settings.highlightOpacityDesc"))
			.addSlider((slider) =>
				slider
					.setLimits(0.15, 1, 0.05)
					.setValue(this.plugin.settings.highlightOpacity)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.highlightOpacity = value;
						await this.plugin.saveSettings();
						this.plugin.rerenderPdfHighlights();
					})
			);

		// --- Citation Sidebar ---
		new Setting(containerEl).setName(t("settings.citationSidebar")).setHeading();

		new Setting(containerEl)
			.setName(t("settings.citationSidebarEnabled"))
			.setDesc(t("settings.citationSidebarEnabledDesc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.citationSidebar.enabled)
					.onChange(async (value) => {
						this.plugin.settings.citationSidebar.enabled = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.maxResults"))
			.setDesc(t("settings.maxResultsDesc"))
			.addText((text) =>
				text
					.setPlaceholder("20")
					.setValue(String(this.plugin.settings.citationSidebar.maxResults))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.citationSidebar.maxResults = num;
							await this.plugin.saveSettings();
						}
					})
			);

			new Setting(containerEl)
				.setName(t("settings.arxivFieldAliases"))
				.setDesc(t("settings.arxivFieldAliasesDesc"))
				.addText((text) =>
					text
						.setPlaceholder(t("settings.arxivFieldAliasesPlaceholder"))
						.setValue(
							formatFieldAliases(
								this.plugin.settings.citationSidebar.arxivFieldAliases
							)
						)
						.onChange(async (value) => {
							this.plugin.settings.citationSidebar.arxivFieldAliases =
								parseFieldAliasInput(value, DEFAULT_ARXIV_FIELD_ALIASES);
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName(t("settings.doiFieldAliases"))
				.setDesc(t("settings.doiFieldAliasesDesc"))
				.addText((text) =>
					text
						.setPlaceholder(t("settings.doiFieldAliasesPlaceholder"))
						.setValue(
							formatFieldAliases(
								this.plugin.settings.citationSidebar.doiFieldAliases
							)
						)
						.onChange(async (value) => {
							this.plugin.settings.citationSidebar.doiFieldAliases =
								parseFieldAliasInput(value, DEFAULT_DOI_FIELD_ALIASES);
							await this.plugin.saveSettings();
						})
				);

		new Setting(containerEl)
			.setName(t("settings.semanticScholarApiKey"))
			.setDesc(t("settings.semanticScholarApiKeyDesc"))
			.addText((text) => {
				text
					.setPlaceholder(t("settings.semanticScholarApiKeyPlaceholder"))
					.setValue(this.plugin.settings.citationSidebar.semanticScholarApiKey)
					.onChange(async (value) => {
						this.plugin.settings.citationSidebar.semanticScholarApiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});
	}

	private addHighlightColorSetting(
		containerEl: HTMLElement,
		type: keyof typeof DEFAULT_TYPE_COLOR_MAP,
		name: string,
		desc: string
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addColorPicker((picker) =>
				picker
					.setValue(
						this.plugin.settings.typeColorMap[type] ??
							DEFAULT_TYPE_COLOR_MAP[type] ??
							"#ffd000"
					)
					.onChange(async (value) => {
						this.plugin.settings.typeColorMap = {
							...this.plugin.settings.typeColorMap,
							[type]: value,
						};
						await this.plugin.saveSettings();
						this.plugin.rerenderPdfHighlights();
					})
			);
	}

	private renderQueueSection(): void {
		this.renderSingleQueueSection(
			this.analysisQueueSectionEl,
			t("settings.analysisQueue"),
			"search",
			this.plugin.analyzeQueue?.getQueue() ?? [],
			() => this.plugin.analyzeQueue?.clearDone()
		);
		this.renderSingleQueueSection(
			this.summaryQueueSectionEl,
			t("settings.summaryQueue"),
			"file-text",
			this.plugin.summaryQueue?.getQueue() ?? [],
			() => this.plugin.summaryQueue?.clearDone()
		);
	}

	private renderSingleQueueSection(
		container: HTMLElement | null,
		title: string,
		icon: string,
		queue: Array<{
			pdfFile: string;
			status: "pending" | "running" | "done" | "error";
			progress?: {
				done?: number;
				total?: number;
				phase?: string;
				message?: string;
				activeWorkers?: number;
				pendingWorkers?: number;
				currentPointerLabel?: string;
			};
		}>,
		clearCompleted?: () => Promise<void>
	): void {
		if (!container) return;
		container.empty();

		const pending = queue.filter((item) => item.status === "pending").length;
		const running = queue.find((item) => item.status === "running");
		const done = queue.filter((item) => item.status === "done").length;
		const errors = queue.filter((item) => item.status === "error").length;
		const card = container.createDiv({ cls: "paper-analyzer-queue-card" });
		const header = card.createDiv({ cls: "paper-analyzer-queue-card-header" });
		const titleGroup = header.createDiv({
			cls: "paper-analyzer-queue-card-title-group",
		});
		const iconEl = titleGroup.createDiv({ cls: "paper-analyzer-queue-card-icon" });
		setIcon(iconEl, icon);

		const copyEl = titleGroup.createDiv({ cls: "paper-analyzer-queue-card-copy" });
		copyEl.createEl("div", {
			text: title,
			cls: "paper-analyzer-queue-card-title",
		});
		copyEl.createEl("div", {
			text: t("settings.queueStats", {
				pending: String(pending),
				done: String(done),
				errors: String(errors),
			}),
			cls: "paper-analyzer-queue-card-stats",
		});

		if ((done > 0 || errors > 0) && clearCompleted) {
			const button = header.createEl("button", {
				text: t("settings.clearCompleted"),
				cls: "paper-analyzer-queue-card-button",
			});
			button.type = "button";
			button.addEventListener("click", async () => {
				button.disabled = true;
				try {
					await clearCompleted();
				} finally {
					button.disabled = false;
				}
			});
		}

		if (queue.length === 0) {
			card.createEl("p", {
				text: t("settings.queueEmpty"),
				cls: "paper-analyzer-queue-card-empty",
			});
			return;
		}

		if (running) {
			const name = running.pdfFile.split("/").pop() ?? running.pdfFile;
			const details = [
				running.progress?.phase?.trim(),
				running.progress?.message?.trim() &&
				running.progress.message !== running.progress.phase
					? running.progress.message.trim()
					: "",
				running.progress?.currentPointerLabel?.trim(),
				formatQueueWorkers(
					this.plugin.settings.language,
					running.progress?.activeWorkers,
					running.progress?.pendingWorkers
				),
			].filter(Boolean);

			const progressEl = card.createDiv({ cls: "paper-analyzer-queue-progress" });
			const progressHeader = progressEl.createDiv({
				cls: "paper-analyzer-queue-progress-header",
			});
			const progressCopy = progressHeader.createDiv({
				cls: "paper-analyzer-queue-progress-copy",
			});
			progressCopy.createEl("div", {
				text: t("settings.queueProcessing", { name }),
				cls: "paper-analyzer-queue-progress-title",
			});
			if (details.length > 0) {
				progressCopy.createEl("div", {
					text: details.join(" · "),
					cls: "paper-analyzer-queue-progress-detail",
				});
			}

			const total = running.progress?.total ?? 0;
			const doneCount = running.progress?.done ?? 0;
			progressHeader.createEl("div", {
				text:
					total > 0
						? `${doneCount}/${total}`
						: this.plugin.settings.language === "zh-CN"
							? "运行中"
							: "Running",
				cls: "paper-analyzer-queue-progress-ratio",
			});

			const bar = progressEl.createDiv({
				cls: "paper-analyzer-progress-bar paper-analyzer-progress-bar--queue",
			});
			const fill = bar.createDiv({ cls: "paper-analyzer-progress-fill" });
			if (total > 0) {
				fill.style.width = `${Math.round((doneCount / total) * 100)}%`;
			} else {
				fill.addClass("paper-analyzer-progress-fill--running");
			}
		}
	}
}
