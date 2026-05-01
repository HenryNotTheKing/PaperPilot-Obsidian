export type LocaleId = "en" | "zh-CN";

export interface Translations {
  common: {
    ok: string;
    cancel: string;
    error: string;
    done: string;
    loading: string;
    processing: string;
  };
  settings: {
    language: string;
    languageDesc: string;
    filePaths: string;
    attachmentFolder: string;
    attachmentFolderDesc: string;
    attachmentFolderPlaceholder: string;
    notesFolder: string;
    notesFolderDesc: string;
    notesFolderPlaceholder: string;
    duplicateHandling: string;
    existingPdfAction: string;
    existingPdfActionDesc: string;
    existingNoteAction: string;
    existingNoteActionDesc: string;
    duplicateActionAsk: string;
    duplicateActionReuse: string;
    duplicateActionOverwrite: string;
    paperNoteTemplate: string;
    paperNoteTemplateDesc: string;
    paperNoteTemplateFieldName: string;
    paperNoteTemplateHelp: string;
    extractionModel: string;
    extractionModelDesc: string;
    summaryModel: string;
    summaryModelDesc: string;
    huggingFace: string;
    huggingFaceDesc: string;
    huggingFaceUserId: string;
    huggingFaceUserIdDesc: string;
    huggingFaceUserIdPlaceholder: string;
    huggingFaceApiKey: string;
    huggingFaceApiKeyDesc: string;
    huggingFaceApiKeyPlaceholder: string;
    preferHuggingFaceMarkdown: string;
    preferHuggingFaceMarkdownDesc: string;
    baseUrl: string;
    baseUrlDesc: string;
    provider: string;
    providerDesc: string;
    providerAuto: string;
    providerOpenAI: string;
    providerAnthropic: string;
    apiKey: string;
    apiKeyPlaceholder: string;
    model: string;
    modelPlaceholder: string;
    summaryGeneration: string;
    summaryGenerationDesc: string;
    autoAnalyzeAfterImport: string;
    autoAnalyzeAfterImportDesc: string;
    autoSummarizeAfterImport: string;
    autoSummarizeAfterImportDesc: string;
    defaultSummaryEffort: string;
    defaultSummaryEffortDesc: string;
    summaryEffortLow: string;
    summaryEffortMedium: string;
    summaryEffortHigh: string;
    summaryEffortExtream: string;
    summaryPrompts: string;
    summaryPromptsDesc: string;
    summaryLowPrompt: string;
    summaryLowPromptDesc: string;
    summaryMediumPrompt: string;
    summaryMediumPromptDesc: string;
    summaryHighPrompt: string;
    summaryHighPromptDesc: string;
    summaryExtreamPrompt: string;
    summaryExtreamPromptDesc: string;
    extractionPrompt: string;
    promptDesc: string;
    promptFieldName: string;
    promptRestoreDesc: string;
    restoreDefault: string;
    highlightColors: string;
    highlightColorsDesc: string;
    resetHighlightColors: string;
    motivationColor: string;
    motivationColorDesc: string;
    keyStepColor: string;
    keyStepColorDesc: string;
    contributionColor: string;
    contributionColorDesc: string;
    highlightOpacity: string;
    highlightOpacityDesc: string;
    advanced: string;
    llmConcurrency: string;
    llmConcurrencyDesc: string;
    analysisQueue: string;
    summaryQueue: string;
    queueEmpty: string;
    queueProcessing: string;
    queueStats: string;
    clearCompleted: string;
    citationSidebar: string;
    citationSidebarEnabled: string;
    citationSidebarEnabledDesc: string;
    maxResults: string;
    maxResultsDesc: string;
    arxivFieldAliases: string;
    arxivFieldAliasesDesc: string;
    arxivFieldAliasesPlaceholder: string;
    doiFieldAliases: string;
    doiFieldAliasesDesc: string;
    doiFieldAliasesPlaceholder: string;
    semanticScholarApiKey: string;
    semanticScholarApiKeyDesc: string;
    semanticScholarApiKeyPlaceholder: string;
    citationExport: string;
    citationExportDesc: string;
    citationExportDefaultFormat: string;
    citationExportDefaultFormatDesc: string;
    citationCustomFormats: string;
    citationCustomFormatsDesc: string;
    citationAddCustomFormat: string;
    citationDeleteCustomFormat: string;
    citationCustomFormatName: string;
  };
  notices: {
    noArxivId: string;
    pdfNotFound: string;
    enterArxivUrl: string;
    importComplete: string;
    analysisComplete: string;
    clearedOldHighlights: string;
    summaryComplete: string;
    summaryNoteNotFound: string;
  };
  summaryStatus: {
    parsing: string;
    parsingDesc: string;
    generating: string;
    generatingDesc: string;
    highSourcePhase: string;
    highSourceMessage: string;
    highSourceResolved: string;
    highPlanningPhase: string;
    highPlanningMessage: string;
    highSectionsPhase: string;
    highSectionsRunning: string;
    highSectionsCompleted: string;
    highSectionsSkipped: string;
    highFormulasPhase: string;
    highFormulasRunning: string;
    highFormulasCompleted: string;
    highFormulasSkipped: string;
    highMergePhase: string;
    highMergeMessage: string;
    highReviewPhase: string;
    highReviewMessage: string;
    highReviewRunning: string;
    highReviewDisabled: string;
    highRenderPhase: string;
    highRenderMessage: string;
    writing: string;
    writingDesc: string;
    done: string;
    doneDesc: string;
  };
  commands: {
    importArxivPaper: string;
    analyzeCurrentPaper: string;
    summarizeCurrentPaper: string;
    openCitationSidebar: string;
    exportCitationCurrent: string;
    exportCitationByTag: string;
    ribbonImport: string;
    ribbonCitationGraph: string;
  };
  importModal: {
    heading: string;
    autoAnalyze: string;
    autoAnalyzeDesc: string;
    autoSummarize: string;
    autoSummarizeDesc: string;
    importButton: string;
    taskHighlight: string;
    taskSummary: string;
    taskWaiting: string;
    taskRunning: string;
    taskDone: string;
    taskQueued: string;
    duplicatePdfHeading: string;
    duplicatePdfDesc: string;
    duplicateNoteHeading: string;
    duplicateNoteDesc: string;
    useExistingButton: string;
    redownloadButton: string;
    overwriteNoteButton: string;
    stepFetchingMetadata: string;
    stepDownloadingPdf: string;
    stepCreatingNote: string;
    invalidArxivUrl: string;
    placeholder: string;
    addRow: string;
  };
  analyzeModal: {
    heading: string;
    pdfLabel: string;
    startButton: string;
    cancelButton: string;
    waitingInQueue: string;
    analyzing: string;
    done: string;
    errorPrefix: string;
    chunksProgress: string;
    spinnerHints: string[];
  };
  summaryModal: {
    heading: string;
    sourceLabel: string;
    pdfLabel: string;
    noteLabel: string;
    noteAutoResolve: string;
    effortLabel: string;
    effortDesc: string;
    startButton: string;
    cancelButton: string;
    loadingTarget: string;
    waitingInQueue: string;
    running: string;
    done: string;
    errorPrefix: string;
    progressLabel: string;
    pdfNotLinked: string;
    unsupportedFile: string;
  };
  citationSidebar: {
    displayText: string;
    citedByTab: string;
    referencesTab: string;
    loading: string;
    noCitationsFound: string;
    openNoteWithId: string;
  };
  citationCard: {
    importTooltip: string;
    unknownAuthors: string;
    noAbstract: string;
    relevanceInfluence: string;
  };
  citationExport: {
    heading: string;
    scopeLabel: string;
    scopeCurrent: string;
    scopeByTag: string;
    tagLabel: string;
    tagDesc: string;
    tagPlaceholder: string;
    tagNoMatch: string;
    tagMatchCount: string;
    formatLabel: string;
    venuePresetLabel: string;
    venuePresetDesc: string;
    venuePresetNone: string;
    previewLabel: string;
    previewPlaceholder: string;
    generateBtn: string;
    copyBtn: string;
    noCurrentNote: string;
    resolvingOne: string;
    noIdFound: string;
    enterTag: string;
    resolvingTag: string;
    resolvingProgress: string;
    noMatchingNotes: string;
    missingFieldsWarning: string;
    copiedNotice: string;
    guideTitle: string;
    guideBody: string;
  };
  systemPrompt: {
    extractionPrompt: string;
  };
}

const en: Translations = {
  common: {
    ok: "OK",
    cancel: "Cancel",
    error: "Error",
    done: "Done",
    loading: "Loading...",
    processing: "Processing...",
  },
  settings: {
    language: "Language",
    languageDesc: "Switch between English and Chinese",
    filePaths: "File paths",
    attachmentFolder: "Attachment folder",
    attachmentFolderDesc: "Where to save downloaded PDFs (relative to vault root)",
    attachmentFolderPlaceholder: "Papers/PDFs",
    notesFolder: "Notes folder",
    notesFolderDesc: "Where to create paper notes",
    notesFolderPlaceholder: "Papers/Notes",
    duplicateHandling: "Duplicate handling",
    existingPdfAction: "When the PDF already exists",
    existingPdfActionDesc: "Choose whether to ask, reuse the existing PDF, or overwrite it with a fresh download.",
    existingNoteAction: "When the note already exists",
    existingNoteActionDesc: "Choose whether to ask, reuse the existing note, or overwrite it with regenerated frontmatter and content.",
    duplicateActionAsk: "Always ask",
    duplicateActionReuse: "Reuse existing",
    duplicateActionOverwrite: "Overwrite existing",
    paperNoteTemplate: "Paper note template",
    paperNoteTemplateDesc: "Customize the Markdown note created during import.",
    paperNoteTemplateFieldName: "Template",
    paperNoteTemplateHelp: "Available placeholders: {{arxiv_id}}, {{title}}, {{title_frontmatter}}, {{authors_yaml}}, {{published}}, {{abstract}}, {{pdf_file}}.",
    extractionModel: "Extraction model",
    extractionModelDesc: "Used for per-section highlight extraction (available in phase 2).",
    summaryModel: "Summary model",
    summaryModelDesc: "Used for full-paper summary generation (available in phase 2).",
    huggingFace: "Hugging Face paper markdown",
    huggingFaceDesc: "Use Hugging Face paper pages as the preferred full-paper source for summary generation when an arXiv paper has an indexed markdown page.",
    huggingFaceUserId: "Hugging Face account ID",
    huggingFaceUserIdDesc: "Optional. Stored for future authenticated paper workflows.",
    huggingFaceUserIdPlaceholder: "your-hf-username",
    huggingFaceApiKey: "Hugging Face API key",
    huggingFaceApiKeyDesc: "Optional bearer token for authenticated Hugging Face paper requests. Public paper markdown pages work without it.",
    huggingFaceApiKeyPlaceholder: "hf_...",
    preferHuggingFaceMarkdown: "Prefer Hugging Face paper markdown",
    preferHuggingFaceMarkdownDesc: "Use https://huggingface.co/papers/{arxiv_id}.md as the primary summary source when available, then fall back to PDF parsing.",
    baseUrl: "Base URL",
    baseUrlDesc: "e.g. https://api.siliconflow.cn/v1, http://localhost:11434/v1, or https://api.anthropic.com",
    provider: "Provider",
    providerDesc: "Auto-detect from Base URL by default. Override this only when using a proxy or custom gateway.",
    providerAuto: "Auto detect from Base URL",
    providerOpenAI: "OpenAI-compatible",
    providerAnthropic: "Anthropic Messages",
    apiKey: "API key",
    apiKeyPlaceholder: "sk-...",
    model: "Model",
    modelPlaceholder: "Qwen/Qwen3-8B",
    summaryGeneration: "Summary generation",
    summaryGenerationDesc: "These settings prepare the separate summary pipeline before commands and queue execution are wired in.",
    autoAnalyzeAfterImport: "Auto-highlight after import",
    autoAnalyzeAfterImportDesc: "Queue highlight extraction automatically after paper import.",
    autoSummarizeAfterImport: "Auto-summarize after import",
    autoSummarizeAfterImportDesc: "When the summary pipeline is enabled, enqueue a summary automatically after paper import.",
    defaultSummaryEffort: "Default summary effort",
    defaultSummaryEffortDesc: "Used by future auto-summary and the summary command as the default starting level.",
    summaryEffortLow: "Low",
    summaryEffortMedium: "Medium",
    summaryEffortHigh: "High",
    summaryEffortExtream: "Extreme",
    summaryPrompts: "Summary prompts",
    summaryPromptsDesc: "Edit the low, medium, high, and extreme summary prompts for the current plugin language. Generated summaries will follow the selected language.",
    summaryLowPrompt: "Low effort prompt",
    summaryLowPromptDesc: "Used for compact one-paragraph paper summaries.",
    summaryMediumPrompt: "Medium effort prompt",
    summaryMediumPromptDesc: "Used for structured paper summaries with explicit sections.",
    summaryHighPrompt: "High effort prompt",
    summaryHighPromptDesc: "Used for deep tutorial-style explanations with formula and mechanism detail.",
    summaryExtreamPrompt: "Extreme effort prompt",
    summaryExtreamPromptDesc: "Used for the most exhaustive tutorial-style walkthrough with deeper review and explanation.",
    extractionPrompt: "Extraction prompt",
    promptDesc: "System prompt sent with every chunk. Use types: motivation, key_step, contribution.",
    promptFieldName: "Prompt",
    promptRestoreDesc: "Restore default to reset.",
    restoreDefault: "Restore default",
    highlightColors: "Highlight colors",
    highlightColorsDesc: "Customize PDF highlight colors for motivation, key steps, and contributions.",
    resetHighlightColors: "Reset colors",
    motivationColor: "Motivation color",
    motivationColorDesc: "Used for background, problem, and gap highlights.",
    keyStepColor: "Key step color",
    keyStepColorDesc: "Used for method, formula, and setup highlights.",
    contributionColor: "Contribution color",
    contributionColorDesc: "Used for result, performance, and conclusion highlights.",
    highlightOpacity: "Highlight opacity",
    highlightOpacityDesc: "Control how strong the PDF highlights appear. Higher values look darker and more vivid.",
    advanced: "Advanced",
    llmConcurrency: "LLM concurrency",
    llmConcurrencyDesc: "Maximum simultaneous LLM requests (1–10)",
    analysisQueue: "Analysis queue",
    summaryQueue: "Summary queue",
    queueEmpty: "No analysis tasks queued.",
    queueProcessing: "Processing: {name}",
    queueStats: "Pending: {pending}   Done: {done}   Errors: {errors}",
    clearCompleted: "Clear completed",
    citationSidebar: "Citation sidebar",
    citationSidebarEnabled: "Enabled",
    citationSidebarEnabledDesc: "Show the citation graph sidebar for supported paper notes and PDFs",
    maxResults: "Max results",
    maxResultsDesc: "Maximum number of citations/references to fetch (per direction)",
    arxivFieldAliases: "arXiv field aliases",
    arxivFieldAliasesDesc: "Comma-separated frontmatter fields checked for arXiv IDs.",
    arxivFieldAliasesPlaceholder: "arxiv_id, arxiv",
    doiFieldAliases: "DOI field aliases",
    doiFieldAliasesDesc: "Comma-separated frontmatter fields checked for DOI values.",
    doiFieldAliasesPlaceholder: "doi",
    semanticScholarApiKey: "Semantic Scholar API key",
    semanticScholarApiKeyDesc: "Optional — without a key the sidebar works but is rate-limited to 1 req/s. Get a free key at semanticscholar.org/product/api.",
    semanticScholarApiKeyPlaceholder: "Enter your Semantic Scholar API key",
    citationExport: "Citation export",
    citationExportDesc: "Configure default citation format and custom format templates.",
    citationExportDefaultFormat: "Default format",
    citationExportDefaultFormatDesc: "The format pre-selected when opening the export modal.",
    citationCustomFormats: "Custom formats",
    citationCustomFormatsDesc: "Define reusable citation templates. Placeholders: {title} {authors} {year} {doi} {arxiv_id} {url} {venue}",
    citationAddCustomFormat: "Add format",
    citationDeleteCustomFormat: "Delete format",
    citationCustomFormatName: "Format name",
  },
  notices: {
    noArxivId: "No arxiv_id in frontmatter — import the paper first",
    pdfNotFound: "PDF not found at: {path}",
    enterArxivUrl: "Enter at least one ArXiv URL.",
    importComplete: "Import complete: {succeeded} succeeded, {failed} failed",
    analysisComplete: "Analysis complete: {basename}",
    clearedOldHighlights: "Cleared previous highlights for {basename}. Waiting for the new analysis result.",
    summaryComplete: "Summary generated: {basename}",
    summaryNoteNotFound: "No matching paper note found for summary generation: {path}",
  },
  summaryStatus: {
    parsing: "Preparing paper content",
    parsingDesc: "Reading Hugging Face markdown or PDF text for summary generation.",
    generating: "Generating summary",
    generatingDesc: "Sending the paper context to the summary model.",
    highSourcePhase: "Extreme source planning",
    highSourceMessage: "Collecting the richest paper source and building source pointers.",
    highSourceResolved: "Resolved source bundle from {source}.",
    highPlanningPhase: "Tutorial planning",
    highPlanningMessage: "Selecting which sections and formulas deserve detailed explanation.",
    highSectionsPhase: "Section explainers",
    highSectionsRunning: "Explaining sections {done}/{total}: {label}",
    highSectionsCompleted: "Completed section explainers: {count}",
    highSectionsSkipped: "No section explainers were needed.",
    highFormulasPhase: "Formula explainers",
    highFormulasRunning: "Explaining formulas {done}/{total}: {label}",
    highFormulasCompleted: "Completed formula explainers: {count}",
    highFormulasSkipped: "No formulas were selected for extra explanation.",
    highMergePhase: "Draft merge",
    highMergeMessage: "Merging section and formula explainers into the first tutorial draft.",
    highReviewPhase: "Review and expansion",
    highReviewMessage: "Reviewing the draft for compressed concepts and missing formula context.",
    highReviewRunning: "Applying targeted revisions {done}/{total}: {label}",
    highReviewDisabled: "Extreme review is disabled in settings.",
    highRenderPhase: "Final render",
    highRenderMessage: "Rendering the final tutorial Markdown with selected figure inserts.",
    writing: "Writing summary",
    writingDesc: "Updating the managed summary block in the note.",
    done: "Summary done",
    doneDesc: "Summary block updated.",
  },
  commands: {
    importArxivPaper: "Import arxiv paper",
    analyzeCurrentPaper: "Analyze current paper with AI",
    summarizeCurrentPaper: "Summarize current paper with AI",
    openCitationSidebar: "Open citation graph sidebar",
    exportCitationCurrent: "Export citation for current note",
    exportCitationByTag: "Export citations by tag",
    ribbonImport: "Import arxiv paper",
    ribbonCitationGraph: "Citation graph",
  },
  importModal: {
    heading: "Import ArXiv papers",
    autoAnalyze: "Auto-analyze after import",
    autoAnalyzeDesc: "Queue AI highlight extraction automatically after each paper is imported.",
    autoSummarize: "Auto-summarize after import",
    autoSummarizeDesc: "Queue AI summary generation automatically after each paper is imported.",
    importButton: "Import",
    taskHighlight: "Highlight task",
    taskSummary: "Summary task",
    taskWaiting: "Waiting for import to finish",
    taskRunning: "Running",
    taskDone: "Done",
    taskQueued: "Queued",
    duplicatePdfHeading: "PDF already exists",
    duplicatePdfDesc: "Found an existing PDF for {title} at {path}. Choose \"Use existing\" to keep the current file, or \"Re-download\" to overwrite it.",
    duplicateNoteHeading: "Note already exists",
    duplicateNoteDesc: "Found an existing note for {title} at {path}. Choose \"Use existing\" to keep the current note, or \"Overwrite note\" to regenerate it from the latest metadata.",
    useExistingButton: "Use existing",
    redownloadButton: "Re-download",
    overwriteNoteButton: "Overwrite note",
    stepFetchingMetadata: "Fetching metadata…",
    stepDownloadingPdf: "Downloading PDF…",
    stepCreatingNote: "Creating note…",
    invalidArxivUrl: "Invalid ArXiv URL: {url}",
    placeholder: "https://arxiv.org/abs/...",
    addRow: "+",
  },
  analyzeModal: {
    heading: "Analyze paper with AI",
    pdfLabel: "PDF: {name}",
    startButton: "Start analysis",
    cancelButton: "Cancel",
    waitingInQueue: "Waiting in queue…",
    analyzing: "Analyzing…",
    done: "Done",
    errorPrefix: "Error: ",
    chunksProgress: "{done} / {total} chunks{elapsed}",
    spinnerHints: [
      "Analyzing…",
      "Sending to LLM…",
      "Reading your paper…",
      "Extracting highlights…",
      "Finding key passages…",
      "Identifying contributions…",
      "Processing sections…",
      "Parsing the text…",
      "Almost ready…",
      "Thinking hard…",
    ],
  },
  summaryModal: {
    heading: "Summarize paper with AI",
    sourceLabel: "Current file: {name}",
    pdfLabel: "PDF: {name}",
    noteLabel: "Note: {name}",
    noteAutoResolve: "Note: will be resolved automatically",
    effortLabel: "Summary effort",
    effortDesc: "Choose how much detail to include in the generated summary.",
    startButton: "Start summary",
    cancelButton: "Cancel",
    loadingTarget: "Resolving paper files…",
    waitingInQueue: "Waiting in queue…",
    running: "Generating summary…",
    done: "Done",
    errorPrefix: "Error: ",
    progressLabel: "{stage}  {done} / {total}{elapsed}",
    pdfNotLinked: "Could not find a PDF linked to this note.",
    unsupportedFile: "Open a paper PDF or paper note first.",
  },
  citationSidebar: {
    displayText: "Citation Graph",
    citedByTab: "Cited by ({count})",
    referencesTab: "References ({count})",
    loading: "Loading citations…",
    noCitationsFound: "No citations found for this paper.",
    openNoteWithId: "Open a paper note or PDF that can be matched to an arXiv or DOI. You can add custom YAML field aliases in settings.",
  },
  citationCard: {
    importTooltip: "Import and analyze this paper",
    unknownAuthors: "Unknown authors",
    noAbstract: "No abstract available.",
    relevanceInfluence: "Relevance: {similarity}%  Influence: {influence}%",
  },
  citationExport: {
    heading: "Export citations",
    scopeLabel: "Scope",
    scopeCurrent: "Current note",
    scopeByTag: "By tag",
    tagLabel: "Tag",
    tagDesc: "Notes tagged with this tag will be included.",
    tagPlaceholder: "e.g. papers/transformer",
    tagNoMatch: "No notes found with tag \"{tag}\".",
    tagMatchCount: "{count} note(s) found with tag \"{tag}\".",
    formatLabel: "Format",
    venuePresetLabel: "Venue preset",
    venuePresetDesc: "Override the booktitle for BibTeX @inproceedings entries.",
    venuePresetNone: "— None —",
    previewLabel: "Preview",
    previewPlaceholder: "Click \"Generate\" to preview the output.",
    generateBtn: "Generate",
    copyBtn: "Copy to clipboard",
    noCurrentNote: "No active Markdown note.",
    resolvingOne: "Resolving metadata…",
    noIdFound: "No arxiv_id or doi found in frontmatter.",
    enterTag: "Please enter a tag.",
    resolvingTag: "Resolving notes for tag \"{tag}\"…",
    resolvingProgress: "Resolved {done} / {total}…",
    noMatchingNotes: "No matching notes found for tag \"{tag}\".",
    missingFieldsWarning: "Warning: missing fields — {fields}",
    copiedNotice: "Copied {count} citation(s) to clipboard.",
    guideTitle: "Which fields are read?",
    guideBody: "Reads from note frontmatter: arxiv_id / doi (required), title, published or year, authors (optional — auto-fetched from arXiv if missing), venue / journal / booktitle (optional). Custom template placeholders: {title} {authors} {year} {doi} {arxiv_id} {url} {venue}",
  },
  systemPrompt: {
    extractionPrompt: `You are a research analyst. Scan the given academic paper section and mark important sentences.
Return JSON only.

RULE 1: For each important sentence, output:
  - "exact_text": copy the COMPLETE sentence verbatim from the input. It MUST start from the beginning of the sentence and end at a sentence-ending punctuation (period, question mark, or exclamation mark). Never truncate mid-sentence. If a sentence spans multiple lines, include the full sentence.
  - "type": classify as one of
      "motivation" — research background, problem statement, limitation, gap
      "key_step"   — algorithm, formula, design choice, experimental setup
      "contribution" — claimed result, performance number, ablation, conclusion
RULE 2: Extract 2–5 highlights per section. Return {"highlights": []} if nothing relevant.
RULE 3: Never invent information. Copy text exactly as it appears — do not paraphrase or fix typos.
RULE 4: Do NOT output partial sentences, fragments, or text that starts mid-sentence.
Return JSON: {"highlights": [{"exact_text": "...", "type": "motivation|key_step|contribution"}]}`,
  },
};

const zhCN: Translations = {
  common: {
    ok: "确定",
    cancel: "取消",
    error: "错误",
    done: "完成",
    loading: "加载中...",
    processing: "处理中...",
  },
  settings: {
    language: "语言",
    languageDesc: "在中文和英文之间切换",
    filePaths: "文件路径",
    attachmentFolder: "附件文件夹",
    attachmentFolderDesc: "下载的 PDF 保存路径（相对于保险库根目录）",
    attachmentFolderPlaceholder: "Papers/PDFs",
    notesFolder: "笔记文件夹",
    notesFolderDesc: "创建论文笔记的路径",
    notesFolderPlaceholder: "Papers/Notes",
    duplicateHandling: "重复内容处理",
    existingPdfAction: "当 PDF 已存在时",
    existingPdfActionDesc: "选择每次都询问、直接复用已有 PDF，或重新下载并覆盖它。",
    existingNoteAction: "当笔记已存在时",
    existingNoteActionDesc: "选择每次都询问、直接复用已有笔记，或用最新元数据重新生成并覆盖它。",
    duplicateActionAsk: "每次都询问",
    duplicateActionReuse: "直接复用",
    duplicateActionOverwrite: "直接覆盖",
    paperNoteTemplate: "论文笔记模板",
    paperNoteTemplateDesc: "自定义导入时生成的 Markdown 笔记内容。",
    paperNoteTemplateFieldName: "模板",
    paperNoteTemplateHelp: "可用占位符：{{arxiv_id}}、{{title}}、{{title_frontmatter}}、{{authors_yaml}}、{{published}}、{{abstract}}、{{pdf_file}}。",
    extractionModel: "提取模型",
    extractionModelDesc: "用于分段高亮提取（第二阶段可用）",
    summaryModel: "摘要模型",
    summaryModelDesc: "用于全文摘要生成（第二阶段可用）",
    huggingFace: "Hugging Face 论文 Markdown",
    huggingFaceDesc: "当 arXiv 论文已经在 Hugging Face 上建立 paper page 并生成 Markdown 时，优先把它作为全文总结的数据源。",
    huggingFaceUserId: "Hugging Face 账号 ID",
    huggingFaceUserIdDesc: "可选。先保存下来，后续接入需要登录态的 paper 工作流时可直接复用。",
    huggingFaceUserIdPlaceholder: "your-hf-username",
    huggingFaceApiKey: "Hugging Face API Key",
    huggingFaceApiKeyDesc: "可选的 Bearer Token。公开论文 Markdown 页面本身不强制需要它，但带上后便于后续扩展认证请求。",
    huggingFaceApiKeyPlaceholder: "hf_...",
    preferHuggingFaceMarkdown: "优先使用 Hugging Face 论文 Markdown",
    preferHuggingFaceMarkdownDesc: "当 https://huggingface.co/papers/{arxiv_id}.md 可用时，优先把它作为总结数据源；拿不到再回退 PDF 解析。",
    baseUrl: "接口地址",
    baseUrlDesc: "例如 https://api.siliconflow.cn/v1、http://localhost:11434/v1 或 https://api.anthropic.com",
    provider: "接口协议",
    providerDesc: "默认根据接口地址自动判断；仅在使用代理或自定义网关时手动覆盖。",
    providerAuto: "根据接口地址自动判断",
    providerOpenAI: "OpenAI 兼容",
    providerAnthropic: "Anthropic Messages",
    apiKey: "API 密钥",
    apiKeyPlaceholder: "sk-...",
    model: "模型",
    modelPlaceholder: "Qwen/Qwen3-8B",
    summaryGeneration: "摘要生成",
    summaryGenerationDesc: "这一组设置先为独立摘要链路打基础，后续再接命令和队列执行。",
    autoAnalyzeAfterImport: "导入后自动提取高亮",
    autoAnalyzeAfterImportDesc: "导入论文后自动把高亮提取任务加入队列。",
    autoSummarizeAfterImport: "导入后自动生成摘要",
    autoSummarizeAfterImportDesc: "当摘要链路接入后，导入论文后自动把摘要任务加入队列。",
    defaultSummaryEffort: "默认摘要强度",
    defaultSummaryEffortDesc: "未来自动摘要和摘要命令都会默认从这个强度开始。",
    summaryEffortLow: "低",
    summaryEffortMedium: "中",
    summaryEffortHigh: "高",
    summaryEffortExtream: "极致",
    summaryPrompts: "摘要提示词",
    summaryPromptsDesc: "分别编辑当前插件语言下的低、中、高、极致四档摘要提示词。生成结果会跟随所选语言输出。",
    summaryLowPrompt: "低强度提示词",
    summaryLowPromptDesc: "用于一段式的简短论文总结。",
    summaryMediumPrompt: "中强度提示词",
    summaryMediumPromptDesc: "用于带固定结构的论文摘要。",
    summaryHighPrompt: "高强度提示词",
    summaryHighPromptDesc: "用于带公式和机制解释的深度教程式讲解。",
    summaryExtreamPrompt: "极致提示词",
    summaryExtreamPromptDesc: "用于最完整的教程式讲解，包含更深入的审阅补讲与展开说明。",
    extractionPrompt: "提取提示词",
    promptDesc: "系统提示词，随每个文本块发送。使用类型：motivation, key_step, contribution。",
    promptFieldName: "提示词",
    promptRestoreDesc: "恢复默认以重置。",
    restoreDefault: "恢复默认",
    highlightColors: "高亮颜色",
    highlightColorsDesc: "分别自定义 motivation、key step、contribution 三类 PDF 高亮颜色。",
    resetHighlightColors: "恢复默认颜色",
    motivationColor: "Motivation 颜色",
    motivationColorDesc: "用于研究背景、问题和差距类高亮。",
    keyStepColor: "Key step 颜色",
    keyStepColorDesc: "用于方法、公式和实验设置类高亮。",
    contributionColor: "Contribution 颜色",
    contributionColorDesc: "用于结果、性能和结论类高亮。",
    highlightOpacity: "高亮透明度",
    highlightOpacityDesc: "控制 PDF 高亮的深浅。值越高，颜色越明显、越鲜艳。",
    advanced: "高级选项",
    llmConcurrency: "LLM 并发数",
    llmConcurrencyDesc: "最大同时 LLM 请求数（1-10）",
    analysisQueue: "分析队列",
    summaryQueue: "摘要队列",
    queueEmpty: "没有待分析的任务。",
    queueProcessing: "正在处理: {name}",
    queueStats: "待处理: {pending}   已完成: {done}   错误: {errors}",
    clearCompleted: "清除已完成",
    citationSidebar: "引用侧边栏",
    citationSidebarEnabled: "启用",
    citationSidebarEnabledDesc: "为受支持的论文笔记和 PDF 显示引用图侧边栏",
    maxResults: "最大结果数",
    maxResultsDesc: "每次获取引用/参考文献的最大数量（按方向）",
    arxivFieldAliases: "arXiv 字段别名",
    arxivFieldAliasesDesc: "用逗号分隔要检查的 frontmatter 字段名，用于识别 arXiv ID。",
    arxivFieldAliasesPlaceholder: "arxiv_id, arxiv",
    doiFieldAliases: "DOI 字段别名",
    doiFieldAliasesDesc: "用逗号分隔要检查的 frontmatter 字段名，用于识别 DOI。",
    doiFieldAliasesPlaceholder: "doi",
    semanticScholarApiKey: "Semantic Scholar API 密钥",
    semanticScholarApiKeyDesc: "可选 -- 无密钥时侧边栏可用但限速 1 req/s。在 semanticscholar.org/product/api 获取免费密钥。",
    semanticScholarApiKeyPlaceholder: "输入您的 Semantic Scholar API 密钥",
    citationExport: "引用导出",
    citationExportDesc: "配置默认引用格式和自定义格式模板。",
    citationExportDefaultFormat: "默认格式",
    citationExportDefaultFormatDesc: "打开导出面板时预选的格式。",
    citationCustomFormats: "自定义格式",
    citationCustomFormatsDesc: "定义可复用的引用模板。占位符：{title} {authors} {year} {doi} {arxiv_id} {url} {venue}",
    citationAddCustomFormat: "添加格式",
    citationDeleteCustomFormat: "删除格式",
    citationCustomFormatName: "格式名称",
  },
  notices: {
    noArxivId: "前置信息中没有 arxiv_id -- 请先导入论文",
    pdfNotFound: "未找到 PDF: {path}",
    enterArxivUrl: "请输入至少一个 ArXiv URL。",
    importComplete: "导入完成: {succeeded} 成功, {failed} 失败",
    analysisComplete: "分析完成: {basename}",
    clearedOldHighlights: "已清除 {basename} 的旧高亮，等待新的分析结果。",
    summaryComplete: "总结已生成: {basename}",
    summaryNoteNotFound: "未找到可写入总结的论文笔记: {path}",
  },
  summaryStatus: {
    parsing: "准备论文内容",
    parsingDesc: "正在读取 Hugging Face Markdown 或 PDF 文本用于生成总结。",
    generating: "生成总结",
    generatingDesc: "正在把论文上下文发送给总结模型。",
    highSourcePhase: "极致源规划",
    highSourceMessage: "正在收集信息最完整的论文源并建立 source pointer。",
    highSourceResolved: "已使用 {source} 构建 source bundle。",
    highPlanningPhase: "教程规划",
    highPlanningMessage: "正在决定哪些章节和公式值得详细展开。",
    highSectionsPhase: "章节讲解",
    highSectionsRunning: "并发讲解章节 {done}/{total}: {label}",
    highSectionsCompleted: "章节讲解完成: {count}",
    highSectionsSkipped: "没有需要额外展开的章节。",
    highFormulasPhase: "公式讲解",
    highFormulasRunning: "并发讲解公式 {done}/{total}: {label}",
    highFormulasCompleted: "公式讲解完成: {count}",
    highFormulasSkipped: "没有需要额外展开的公式。",
    highMergePhase: "草稿合并",
    highMergeMessage: "正在把章节讲解和公式讲解合并成第一版教程草稿。",
    highReviewPhase: "审阅与补讲",
    highReviewMessage: "正在检查草稿里过于凝练的概念和遗漏的公式上下文。",
    highReviewRunning: "定点补讲 {done}/{total}: {label}",
    highReviewDisabled: "设置中已关闭极致审阅补讲。",
    highRenderPhase: "终稿渲染",
    highRenderMessage: "正在渲染最终教程 Markdown，并插入选中的远程图片。",
    writing: "写入总结",
    writingDesc: "正在更新笔记中的受控总结区块。",
    done: "总结完成",
    doneDesc: "总结区块已更新。",
  },
  commands: {
    importArxivPaper: "导入 ArXiv 论文",
    analyzeCurrentPaper: "用 AI 分析当前论文",
    summarizeCurrentPaper: "用 AI 总结当前论文",
    openCitationSidebar: "打开引用图侧边栏",
    exportCitationCurrent: "导出当前笔记的引用",
    exportCitationByTag: "按 Tag 批量导出引用",
    ribbonImport: "导入论文",
    ribbonCitationGraph: "引用图",
  },
  importModal: {
    heading: "导入 ArXiv 论文",
    autoAnalyze: "导入后自动分析",
    autoAnalyzeDesc: "每篇论文导入后自动排队 AI 高亮提取。",
    autoSummarize: "导入后自动总结",
    autoSummarizeDesc: "每篇论文导入后自动排队 AI 总结生成。",
    importButton: "导入",
    taskHighlight: "高亮任务",
    taskSummary: "总结任务",
    taskWaiting: "等待导入完成",
    taskRunning: "处理中",
    taskDone: "完成",
    taskQueued: "排队中",
    duplicatePdfHeading: "PDF 已存在",
    duplicatePdfDesc: "在 {path} 找到了 {title} 的现有 PDF。你可以选择“使用现有文件”保留当前文件，或选择“重新下载”覆盖它。",
    duplicateNoteHeading: "笔记已存在",
    duplicateNoteDesc: "在 {path} 找到了 {title} 的现有笔记。你可以选择“使用现有文件”保留当前笔记，或选择“覆盖笔记”用最新元数据重新生成它。",
    useExistingButton: "使用现有文件",
    redownloadButton: "重新下载",
    overwriteNoteButton: "覆盖笔记",
    stepFetchingMetadata: "获取元数据...",
    stepDownloadingPdf: "下载 PDF...",
    stepCreatingNote: "创建笔记...",
    invalidArxivUrl: "无效的 ArXiv URL: {url}",
    placeholder: "https://arxiv.org/abs/...",
    addRow: "+",
  },
  analyzeModal: {
    heading: "用 AI 分析论文",
    pdfLabel: "PDF: {name}",
    startButton: "开始分析",
    cancelButton: "取消",
    waitingInQueue: "排队中...",
    analyzing: "分析中...",
    done: "完成",
    errorPrefix: "错误: ",
    chunksProgress: "{done} / {total} 块{elapsed}",
    spinnerHints: [
      "分析中...",
      "发送到 LLM...",
      "正在阅读论文...",
      "提取高亮...",
      "查找关键段落...",
      "识别贡献点...",
      "处理章节...",
      "解析文本...",
      "即将完成...",
      "认真思考中...",
    ],
  },
  summaryModal: {
    heading: "用 AI 总结论文",
    sourceLabel: "当前文件: {name}",
    pdfLabel: "PDF: {name}",
    noteLabel: "笔记: {name}",
    noteAutoResolve: "笔记: 将自动匹配",
    effortLabel: "总结强度",
    effortDesc: "选择生成总结时需要展开到什么程度。",
    startButton: "开始总结",
    cancelButton: "取消",
    loadingTarget: "正在定位论文文件...",
    waitingInQueue: "排队中...",
    running: "总结生成中...",
    done: "完成",
    errorPrefix: "错误: ",
    progressLabel: "{stage}  {done} / {total}{elapsed}",
    pdfNotLinked: "无法从当前笔记找到关联的 PDF。",
    unsupportedFile: "请先打开论文 PDF 或论文笔记。",
  },
  citationSidebar: {
    displayText: "引用图",
    citedByTab: "被引用 ({count})",
    referencesTab: "参考文献 ({count})",
    loading: "正在加载引用...",
    noCitationsFound: "未找到该论文的引用。",
    openNoteWithId: "打开能匹配到 arXiv 或 DOI 的论文笔记或 PDF。你也可以在设置里添加自定义 YAML 字段别名。",
  },
  citationCard: {
    importTooltip: "导入并分析此论文",
    unknownAuthors: "作者未知",
    noAbstract: "无摘要。",
    relevanceInfluence: "相关性: {similarity}%  影响力: {influence}%",
  },
  citationExport: {
    heading: "导出引用",
    scopeLabel: "范围",
    scopeCurrent: "当前笔记",
    scopeByTag: "按 Tag",
    tagLabel: "Tag",
    tagDesc: "将导出带有此 Tag 的所有笔记对应的引用。",
    tagPlaceholder: "例如 papers/transformer",
    tagNoMatch: "未找到带有 Tag \"{tag}\" 的笔记。",
    tagMatchCount: "找到 {count} 篇带有 Tag \"{tag}\" 的笔记。",
    formatLabel: "格式",
    venuePresetLabel: "期刊/会议预设",
    venuePresetDesc: "覆盖 BibTeX @inproceedings 条目的 booktitle 字段。",
    venuePresetNone: "— 不使用预设 —",
    previewLabel: "预览",
    previewPlaceholder: "点击「生成」预览输出内容。",
    generateBtn: "生成",
    copyBtn: "复制到剪贴板",
    noCurrentNote: "当前没有活跃的 Markdown 笔记。",
    resolvingOne: "正在解析元数据…",
    noIdFound: "frontmatter 中未找到 arxiv_id 或 doi。",
    enterTag: "请输入 Tag。",
    resolvingTag: "正在解析 Tag \"{tag}\" 下的笔记…",
    resolvingProgress: "已解析 {done} / {total}…",
    noMatchingNotes: "Tag \"{tag}\" 下未找到匹配笔记。",
    missingFieldsWarning: "警告：缺少字段 — {fields}",
    copiedNotice: "已复制 {count} 条引用到剪贴板。",
    guideTitle: "插件读取哪些字段？",
    guideBody: "从笔记 frontmatter 中读取：arxiv_id / doi（必需）、title、published 或 year、authors（可选，缺失时自动从 arXiv API 获取）、venue / journal / booktitle（可选）。自定义模板占位符：{title} {authors} {year} {doi} {arxiv_id} {url} {venue}",
  },
  systemPrompt: {
    extractionPrompt: `你是一位研究分析师。扫描给定的学术论文章节并标记重要句子。
仅返回 JSON。

规则 1: 对于每个重要句子，输出:
  - "exact_text": 从输入中逐字复制完整句子。必须从句子开头复制到句末标点（句号、问号或感叹号）。绝不能截断句子。如果句子跨越多行，需包含完整句子。
  - "type": 分类为以下之一
      "motivation" -- 研究背景、问题陈述、局限性、差距
      "key_step"   -- 算法、公式、设计选择、实验设置
      "contribution" -- 声称的结果、性能数字、消融实验、结论
规则 2: 每个章节提取 2-5 个高亮。如果无关则返回 {"highlights": []}。
规则 3: 绝不编造信息。原样复制文本，不要改写或修正拼写错误。
规则 4: 不要输出不完整的句子、片段或从句子中间开始的文本。
返回 JSON: {"highlights": [{"exact_text": "...", "type": "motivation|key_step|contribution"}]}`,
  },
};

const LOCALES: Record<LocaleId, Translations> = { en, "zh-CN": zhCN };

let currentLocale: LocaleId = "en";

export function setLocale(locale: LocaleId): void {
  currentLocale = locale;
}

export function getLocale(): LocaleId {
  return currentLocale;
}

export function getTranslations(): Translations {
  return LOCALES[currentLocale];
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_match: string, key: string) => String(params[key] ?? `{${key}}`));
}

export function t(key: string, params?: Record<string, string | number>): string {
  const parts = key.split(".");
  let value: unknown = LOCALES[currentLocale];
  for (const part of parts) {
    if (value == null || typeof value !== "object") return key;
    value = (value as Record<string, unknown>)[part];
  }
  if (typeof value !== "string" && !Array.isArray(value)) return key;
  if (Array.isArray(value)) return key;
  return interpolate(value, params);
}

export function tArray(key: string): string[] {
  const parts = key.split(".");
  let value: unknown = LOCALES[currentLocale];
  for (const part of parts) {
    if (value == null || typeof value !== "object") return [];
    value = (value as Record<string, unknown>)[part];
  }
  if (!Array.isArray(value)) return [];
  return value as string[];
}

export function detectLocale(obsidianLocale: string): LocaleId {
  if (obsidianLocale.startsWith("zh")) return "zh-CN";
  return "en";
}
