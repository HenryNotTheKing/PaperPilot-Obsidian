import { App, ButtonComponent, Modal, Notice, Setting, TFile } from "obsidian";
import type PaperAnalyzerPlugin from "../main";
import type { CitationRecord } from "../types";
import {
	resolveNoteMetadata,
	resolveTaggedNotes,
	countFilesWithTag,
} from "../services/citation-metadata-resolver";
import {
	formatBibTeX,
	formatIEEE,
	formatCustom,
	VENUE_PRESETS,
} from "../services/citation-formatter";
import { t } from "../i18n";

type ExportScope = "current" | "tag";
type Format = "bibtex" | "ieee" | string;

const MAX_SUGGESTIONS = 8;

export class CitationExportModal extends Modal {
	private plugin: PaperAnalyzerPlugin;
	private initialFile: TFile | null;
	private initialScope: ExportScope;

	// UI state
	private exportScope: ExportScope = "current";
	private tagInput = "";
	private format: Format = "bibtex";
	private venuePresetId = "";
	private generating = false;
	private activeSuggestionIdx = -1;

	// All vault tags (cached on open)
	private allTags: string[] = [];

	// Dynamic element references
	private tagInputEl: HTMLInputElement | null = null;
	private tagCountEl: HTMLElement | null = null;
	private suggestionsEl: HTMLElement | null = null;
	private venuePresetRow: HTMLElement | null = null;
	private previewEl: HTMLTextAreaElement | null = null;
	private progressEl: HTMLElement | null = null;
	private guideEl: HTMLElement | null = null;
	private generateBtn: HTMLButtonElement | null = null;
	private copyBtn: HTMLButtonElement | null = null;
	private tagRow: HTMLElement | null = null;

	constructor(
		app: App,
		plugin: PaperAnalyzerPlugin,
		initialFile?: TFile | null,
		scope: ExportScope = "current"
	) {
		super(app);
		this.plugin = plugin;
		this.initialFile = initialFile ?? null;
		this.initialScope = scope;
		this.exportScope = scope;
		this.format = plugin.settings.citationExport.defaultFormat ?? "bibtex";
	}

	onOpen(): void {
		// Cache all vault tags once
		this.allTags = this.getAllVaultTags();

		const { contentEl } = this;
		contentEl.addClass("paper-analyzer-modal");
		contentEl.addClass("paper-analyzer-citation-export-modal");

		new Setting(contentEl)
			.setName(t("citationExport.heading"))
			.setHeading();

		// ── Scope selector ─────────────────────────────────────────────────────
		new Setting(contentEl)
			.setName(t("citationExport.scopeLabel"))
			.addDropdown((dd) => {
				dd.addOption("current", t("citationExport.scopeCurrent"));
				dd.addOption("tag", t("citationExport.scopeByTag"));
				dd.setValue(this.initialScope);
				dd.onChange((v) => {
					this.exportScope = v as ExportScope;
					this.updateScopeVisibility();
					this.clearPreview();
					this.hideGuide();
				});
			});

		// ── Tag input row (shown when scope === "tag") ─────────────────────────
		this.tagRow = contentEl.createDiv({ cls: "paper-analyzer-citation-tag-row" });
		this.tagRow.style.display = this.exportScope === "tag" ? "" : "none";

		const tagSetting = new Setting(this.tagRow)
			.setName(t("citationExport.tagLabel"))
			.setDesc(t("citationExport.tagDesc"))
			.addText((text) => {
				this.tagInputEl = text.inputEl;
				text.setPlaceholder(t("citationExport.tagPlaceholder"));
				text.inputEl.title = "";

				// Create dropdown inside the control element so it floats below the input
				const controlEl = text.inputEl.parentElement as HTMLElement;
				if (controlEl) {
					controlEl.style.position = "relative";
					this.suggestionsEl = controlEl.createDiv({
						cls: "paper-analyzer-citation-tag-suggestions",
					});
					this.suggestionsEl.style.display = "none";
				}

				text.inputEl.addEventListener("input", () => {
					this.tagInput = text.inputEl.value.trim();
					text.inputEl.title = this.tagInput;
					this.updateTagCount();
					this.updateSuggestions();
					this.clearPreview();
					this.hideGuide();
				});

				text.inputEl.addEventListener("keydown", (e) => {
					this.handleSuggestionKeydown(e);
				});

				// Delay hiding to allow click on suggestion to fire first
				text.inputEl.addEventListener("blur", () => {
					setTimeout(() => this.hideSuggestions(), 150);
				});

				text.inputEl.addEventListener("focus", () => {
					this.updateSuggestions();
				});
			});

		// Use the Setting's desc element for tag count feedback (avoids extra DOM nodes)
		this.tagCountEl = tagSetting.descEl;

		// ── Format selector ────────────────────────────────────────────────────
		new Setting(contentEl)
			.setName(t("citationExport.formatLabel"))
			.addDropdown((dd) => {
				dd.addOption("bibtex", "BibTeX");
				dd.addOption("ieee", "IEEE");
				for (const cf of this.plugin.settings.citationExport.customFormats) {
					dd.addOption(`custom:${cf.name}`, cf.name);
				}
				dd.setValue(this.format);
				dd.onChange((v) => {
					this.format = v;
					this.updateVenuePresetVisibility();
					this.clearPreview();
				});
			});

		// ── Venue preset row (shown when format === "bibtex") ─────────────────
		this.venuePresetRow = contentEl.createDiv({
			cls: "paper-analyzer-citation-venue-row",
		});
		this.venuePresetRow.style.display = this.format === "bibtex" ? "" : "none";

		new Setting(this.venuePresetRow)
			.setName(t("citationExport.venuePresetLabel"))
			.setDesc(t("citationExport.venuePresetDesc"))
			.addDropdown((dd) => {
				dd.addOption("", t("citationExport.venuePresetNone"));
				for (const vp of VENUE_PRESETS) {
					dd.addOption(vp.id, vp.label);
				}
				dd.setValue(this.venuePresetId);
				dd.onChange((v) => {
					this.venuePresetId = v;
					this.clearPreview();
				});
			});

		// ── Progress indicator ─────────────────────────────────────────────────
		this.progressEl = contentEl.createDiv({
			cls: "paper-analyzer-citation-progress setting-item-description",
		});
		this.progressEl.style.cssText = "padding-left:0; display:none;";

		// ── Field guide (hidden by default; revealed when resolve fails) ───────
		this.guideEl = contentEl.createDiv({
			cls: "paper-analyzer-citation-guide",
		});
		this.guideEl.createEl("strong", { text: `ℹ ${t("citationExport.guideTitle")}` });
		this.guideEl.createEl("br");
		this.guideEl.createSpan({ text: t("citationExport.guideBody") });

		// ── Preview textarea ───────────────────────────────────────────────────
		const previewSection = contentEl.createDiv({ cls: "paper-analyzer-citation-preview" });
		previewSection.createEl("div", {
			text: t("citationExport.previewLabel"),
			cls: "setting-item-name",
			attr: { style: "margin-bottom: 6px; font-weight: 600;" },
		});
		this.previewEl = previewSection.createEl("textarea", {
			cls: "paper-analyzer-citation-textarea",
			attr: {
				readonly: "true",
				rows: "12",
				placeholder: t("citationExport.previewPlaceholder"),
				style: "width:100%; font-family: monospace; font-size: 12px; resize: vertical;",
			},
		});

		// ── Action buttons ─────────────────────────────────────────────────────
		const btnRow = contentEl.createDiv({ cls: "paper-analyzer-citation-btn-row" });

		const generateBtnComp = new ButtonComponent(btnRow)
			.setButtonText(t("citationExport.generateBtn"))
			.setCta()
			.onClick(() => void this.handleGenerate());
		this.generateBtn = generateBtnComp.buttonEl;

		const copyBtnComp = new ButtonComponent(btnRow)
			.setButtonText(t("citationExport.copyBtn"))
			.setDisabled(true)
			.onClick(() => this.handleCopy());
		this.copyBtn = copyBtnComp.buttonEl;
	}

	onClose(): void {
		this.contentEl.empty();
	}

	// ── Helpers ──────────────────────────────────────────────────────────────

	// ── Tag autocomplete ──────────────────────────────────────────────────────

	private getAllVaultTags(): string[] {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const tagMap: Record<string, number> = (this.app.metadataCache as any).getTags?.() ?? {};
		return Object.keys(tagMap)
			.map((tag) => (tag.startsWith("#") ? tag.slice(1) : tag))
			.sort((a, b) => a.localeCompare(b));
	}

	private updateSuggestions(): void {
		if (!this.suggestionsEl) return;
		const query = this.tagInput.toLowerCase();

		let matches: string[];
		if (!query) {
			// Show top vault tags when input is focused but empty
			matches = this.allTags.slice(0, MAX_SUGGESTIONS);
		} else {
			matches = this.allTags
				.filter((tag) => tag.toLowerCase().startsWith(query) && tag !== this.tagInput)
				.slice(0, MAX_SUGGESTIONS);
		}

		if (matches.length === 0) {
			this.hideSuggestions();
			return;
		}

		this.suggestionsEl.empty();
		this.activeSuggestionIdx = -1;

		for (const match of matches) {
			const item = this.suggestionsEl.createDiv({
				cls: "paper-analyzer-citation-tag-suggestion",
			});
			item.title = match;

			if (query) {
				// Bold the typed prefix
				const prefixSpan = item.createEl("span", {
					cls: "paper-analyzer-citation-tag-suggestion-prefix",
					text: match.slice(0, this.tagInput.length),
				});
				item.createSpan({ text: match.slice(this.tagInput.length) });
			} else {
				item.createSpan({ text: match });
			}

			item.addEventListener("mousedown", (e) => {
				e.preventDefault(); // prevent blur before click fires
				this.selectSuggestion(match);
			});
		}

		this.suggestionsEl.style.display = "";
	}

	private selectSuggestion(tag: string): void {
		if (this.tagInputEl) {
			this.tagInputEl.value = tag;
			this.tagInputEl.title = tag;
			this.tagInput = tag;
			this.updateTagCount();
			this.clearPreview();
			this.hideGuide();
		}
		this.hideSuggestions();
		this.tagInputEl?.focus();
	}

	private hideSuggestions(): void {
		if (this.suggestionsEl) this.suggestionsEl.style.display = "none";
		this.activeSuggestionIdx = -1;
	}

	private handleSuggestionKeydown(e: KeyboardEvent): void {
		if (!this.suggestionsEl || this.suggestionsEl.style.display === "none") return;
		const items = Array.from(
			this.suggestionsEl.querySelectorAll<HTMLElement>(
				".paper-analyzer-citation-tag-suggestion"
			)
		);
		if (items.length === 0) return;

		if (e.key === "ArrowDown") {
			e.preventDefault();
			this.activeSuggestionIdx = Math.min(
				this.activeSuggestionIdx + 1,
				items.length - 1
			);
			this.highlightSuggestion(items);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			this.activeSuggestionIdx = Math.max(this.activeSuggestionIdx - 1, 0);
			this.highlightSuggestion(items);
		} else if (e.key === "Enter" || e.key === "Tab") {
			if (this.activeSuggestionIdx >= 0 && items[this.activeSuggestionIdx]) {
				e.preventDefault();
				const tag = items[this.activeSuggestionIdx]!.textContent ?? "";
				this.selectSuggestion(tag);
			} else {
				this.hideSuggestions();
			}
		} else if (e.key === "Escape") {
			this.hideSuggestions();
		}
	}

	private highlightSuggestion(items: HTMLElement[]): void {
		items.forEach((el, i) => {
			el.toggleClass("is-active", i === this.activeSuggestionIdx);
		});
		items[this.activeSuggestionIdx]?.scrollIntoView({ block: "nearest" });
	}

	private updateScopeVisibility(): void {
		if (this.tagRow) {
			this.tagRow.style.display = this.exportScope === "tag" ? "" : "none";
		}
	}

	private updateVenuePresetVisibility(): void {
		if (this.venuePresetRow) {
			this.venuePresetRow.style.display = this.format === "bibtex" ? "" : "none";
		}
	}

	private updateTagCount(): void {
		if (!this.tagCountEl) return;
		if (!this.tagInput) {
			// Restore original description text
			this.tagCountEl.setText(t("citationExport.tagDesc"));
			return;
		}
		const count = countFilesWithTag(this.app, this.tagInput);
		this.tagCountEl.setText(
			count === 0
				? t("citationExport.tagNoMatch").replace("{tag}", this.tagInput)
				: t("citationExport.tagMatchCount")
						.replace("{count}", String(count))
						.replace("{tag}", this.tagInput)
		);
	}

	private clearPreview(): void {
		if (this.previewEl) this.previewEl.value = "";
		if (this.copyBtn) this.copyBtn.disabled = true;
	}

	private setProgress(text: string): void {
		if (!this.progressEl) return;
		this.progressEl.setText(text);
		this.progressEl.style.display = text ? "" : "none";
	}

	private showGuide(): void {
		this.guideEl?.addClass("is-visible");
	}

	private hideGuide(): void {
		this.guideEl?.removeClass("is-visible");
	}

	private async handleGenerate(): Promise<void> {
		if (this.generating) return;
		this.generating = true;
		if (this.generateBtn) this.generateBtn.disabled = true;
		this.clearPreview();
		this.hideGuide();

		try {
			let records: CitationRecord[];

			if (this.exportScope === "current") {
				const file = this.initialFile ?? this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") {
					new Notice(t("citationExport.noCurrentNote"));
					return;
				}
				this.setProgress(t("citationExport.resolvingOne"));
				const record = await resolveNoteMetadata(file, this.app, this.plugin.settings);
				if (!record) {
					this.setProgress("");
					new Notice(t("citationExport.noIdFound"));
					this.showGuide();
					return;
				}
				records = [record];
			} else {
				if (!this.tagInput) {
					new Notice(t("citationExport.enterTag"));
					return;
				}
				this.setProgress(
					t("citationExport.resolvingTag").replace("{tag}", this.tagInput)
				);
				records = await resolveTaggedNotes(
					this.tagInput,
					this.app,
					this.plugin.settings,
					(done, total) => {
						this.setProgress(
							t("citationExport.resolvingProgress")
								.replace("{done}", String(done))
								.replace("{total}", String(total))
						);
					}
				);
				if (records.length === 0) {
					this.setProgress("");
					new Notice(
						t("citationExport.noMatchingNotes").replace("{tag}", this.tagInput)
					);
					return;
				}
			}

			// ── Format the records ──────────────────────────────────────────────
			const output = this.renderOutput(records);

			if (this.previewEl) this.previewEl.value = output;
			if (this.copyBtn) this.copyBtn.disabled = false;
			this.setProgress("");
		} finally {
			this.generating = false;
			if (this.generateBtn) this.generateBtn.disabled = false;
		}
	}

	private renderOutput(records: CitationRecord[]): string {
		const parts: string[] = [];

		if (this.format === "bibtex") {
			for (const r of records) {
				parts.push(formatBibTeX(r, this.venuePresetId || undefined));
				if (r.missingFields.length > 0) {
					parts.push(
						`% ⚠ ${t("citationExport.missingFieldsWarning")}: ${r.missingFields.join(", ")}`
					);
				}
			}
			return parts.join("\n\n");
		}

		if (this.format === "ieee") {
			for (let i = 0; i < records.length; i++) {
				const r = records[i]!;
				parts.push(formatIEEE(r, i + 1));
				if (r.missingFields.length > 0) {
					parts.push(
						`⚠ ${t("citationExport.missingFieldsWarning")}: ${r.missingFields.join(", ")}`
					);
				}
			}
			return parts.join("\n\n");
		}

		// Custom format
		if (this.format.startsWith("custom:")) {
			const name = this.format.slice(7);
			const cf = this.plugin.settings.citationExport.customFormats.find(
				(f) => f.name === name
			);
			if (cf) {
				for (const r of records) {
					parts.push(formatCustom(r, cf.template));
					if (r.missingFields.length > 0) {
						parts.push(
							`⚠ ${t("citationExport.missingFieldsWarning")}: ${r.missingFields.join(", ")}`
						);
					}
				}
				return parts.join("\n\n");
			}
		}

		return "";
	}

	private handleCopy(): void {
		const text = this.previewEl?.value ?? "";
		if (!text) return;

		void navigator.clipboard.writeText(text).then(() => {
			// Count entries: for bibtex count '@', for others count lines
			const count =
				this.format === "bibtex"
					? (text.match(/^@/gm) ?? []).length
					: text.split("\n\n").filter((l) => l.trim().length > 0).length;
			new Notice(
				t("citationExport.copiedNotice").replace("{count}", String(count))
			);
		});
	}
}
