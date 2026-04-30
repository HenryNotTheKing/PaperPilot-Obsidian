/**
 * End-to-end validation script: parses a real PDF, chunks it, calls the LLM,
 * and prints section headings + highlights. Run with:
 *   node tests/validate-pipeline.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Load config from secret.txt ──
const secretPath = path.join(ROOT, "secret.txt");
const secrets = Object.fromEntries(
  fs.readFileSync(secretPath, "utf8").trim().split("\n")
    .map(l => l.split("=").map(s => s.trim()))
);
const BASE_URL = secrets.base_url.replace(/\/+$/, "");
const API_KEY = secrets.api_key;
const MODEL = secrets.model_name;

// ── PDF path ──
const PDF_DIR = "D:\\codingProgram\\ob-plugin\\dev\\Papers\\PDFs";
const pdfFile = fs.readdirSync(PDF_DIR).find(f => /attention/i.test(f) && f.endsWith(".pdf"));
if (!pdfFile) { console.error("Cannot find Attention paper PDF"); process.exit(1); }
const pdfPath = path.join(PDF_DIR, pdfFile);
console.log(`PDF: ${pdfPath}\n`);

// ── Parse PDF ──
const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
const bytes = new Uint8Array(fs.readFileSync(pdfPath));
const doc = await pdfjsLib.getDocument({ data: bytes }).promise;

const pages = [];
for (let pn = 1; pn <= doc.numPages; pn++) {
  const page = await doc.getPage(pn);
  const content = await page.getTextContent();
  const items = [];
  let fullText = "";
  let prevY = null, prevH = null;
  content.items.forEach((raw, idx) => {
    if (!raw.str) return;
    const y = raw.transform?.[5] ?? 0;
    const h = raw.height ?? 0;
    if (prevY !== null && prevH !== null) {
      const yDrop = prevY - y;
      if (yDrop > prevH * 1.2) fullText += "\n\n";
      else if (raw.hasEOL) fullText += "\n";
      else fullText += " ";
    }
    items.push({ text: raw.str, height: h, pageNum: pn, index: idx, x: raw.transform?.[4] ?? 0, y, width: raw.width ?? 0 });
    fullText += raw.str;
    prevY = y;
    prevH = h;
  });
  pages.push({ pageNum: pn, items, fullText });
}
console.log(`Parsed ${pages.length} pages, total items: ${pages.reduce((s,p) => s + p.items.length, 0)}\n`);

// ── Chunk (inlined for standalone Node execution) ──
const MAX_CHUNK_CHARS = 1500;
const STOP_PATTERNS = [/^\s*\d*\.?\s*references\s*$/i, /^\s*\d*\.?\s*appendix\b/i, /^\s*\d*\.?\s*acknowledgm/i];
const CAPTION_PATTERN = /^\s*(figure|fig\.|table|tbl\.)\s*\d+/i;
const SECTION_NAME_MAP = [
  { pattern: /^\s*\d*\.?\s*abstract\s*$/i, tag: "abstract" },
  { pattern: /^\s*\d*\.?\s*introduction\s*$/i, tag: "introduction" },
  { pattern: /^\s*\d*\.?\s*(related\s*work|background|literature\s*review)\s*$/i, tag: "related_work" },
  { pattern: /^\s*\d*\.?\s*(method|approach|methodology|model|framework|proposed)\s*$/i, tag: "method" },
  { pattern: /^\s*\d*\.?\s*(experiment|evaluation|results|empirical|experimental)\s*$/i, tag: "experiment" },
  { pattern: /^\s*\d*\.?\s*(conclusion|conclusions|discussion|future\s*work)\s*$/i, tag: "conclusion" },
];

function classifyHeading(text) {
  const t = text.trim();
  for (const { pattern, tag } of SECTION_NAME_MAP) {
    if (pattern.test(t)) return tag;
  }
  return "other";
}

function computeBodyMedian(allItems) {
  const heights = allItems.filter(i => i.text.trim().length > 0).map(i => i.height).sort((a, b) => a - b);
  if (!heights.length) return 12;
  const mid = Math.floor(heights.length / 2);
  return heights.length % 2 !== 0 ? heights[mid] : (heights[mid - 1] + heights[mid]) / 2;
}

function isHeading(item, bodyMedian) {
  const t = item.text.trim();
  if (!t || t.length > 120) return false;
  if (item.height > bodyMedian * 1.35) return true;
  if (item.height > bodyMedian * 1.15 && t.length < 50) return true;
  return false;
}

function findSentenceBoundary(text) {
  for (let i = text.length - 1; i >= Math.floor(text.length * 0.3); i--) {
    const ch = text[i];
    if (ch === "." || ch === "!" || ch === "?") {
      const before = text.slice(Math.max(0, i - 4), i);
      if (/\b(e\.g|i\.e|vs|al|Fig|Eq|Sec|et|Dr|Mr|Mrs|No|Vol)\s*$/i.test(before)) continue;
      return i + 1;
    }
  }
  return -1;
}

function chunkPages(pages) {
  if (!pages.length) return [];
  const allItems = pages.flatMap(p => p.items);
  const bodyMedian = computeBodyMedian(allItems);
  console.log(`Body median height: ${bodyMedian}`);

  const chunks = [];
  let stopped = false, currentText = "", currentPageNum = 1;
  let currentItemStart = 0, currentItemEnd = 0;
  let currentTag = "other", currentHeading = undefined, prevY = null;

  function flush() {
    const trimmed = currentText.trim();
    if (!trimmed) return;
    chunks.push({ pageNum: currentPageNum, sectionTag: currentTag, headingText: currentHeading, text: trimmed, itemRange: [currentItemStart, currentItemEnd] });
    currentText = "";
  }
  function flushSentence() {
    const b = findSentenceBoundary(currentText);
    if (b > 0 && b < currentText.length) {
      const f = currentText.slice(0, b).trim();
      const r = currentText.slice(b).trim();
      if (f) chunks.push({ pageNum: currentPageNum, sectionTag: currentTag, headingText: currentHeading, text: f, itemRange: [currentItemStart, currentItemEnd] });
      currentText = r ? r + " " : "";
    } else flush();
  }

  for (const page of pages) {
    if (stopped) break;
    for (const item of page.items) {
      if (stopped) break;
      const t = item.text.trim();
      if (!t) continue;
      if (STOP_PATTERNS.some(p => p.test(t))) { flush(); stopped = true; break; }
      if (CAPTION_PATTERN.test(t)) continue;
      if (isHeading(item, bodyMedian)) {
        // Merge consecutive heading items on the same line
        const sameLineAsPrev = prevY !== null && Math.abs(item.y - prevY) < bodyMedian * 0.3 && currentText === "";
        if (!sameLineAsPrev) flush();
        const headingRaw = sameLineAsPrev ? (currentHeading ?? "") + " " + t : t;
        currentTag = classifyHeading(headingRaw);
        currentHeading = headingRaw.replace(/^\s*(\d+[\.\):]?\s*)+/, "").replace(/^\s*[IVXLC]+[\.\):]\s*/i, "").trim() || headingRaw.trim();
        currentPageNum = item.pageNum;
        currentItemStart = item.index;
        currentItemEnd = item.index;
        prevY = item.y;
        continue;
      }
      if (prevY !== null) {
        const yDrop = prevY - item.y;
        if (yDrop > bodyMedian * 1.2) {
          if (currentText.length > MAX_CHUNK_CHARS * 0.6) flushSentence();
          else currentText += "\n\n";
        }
      }
      if (!currentText) { currentPageNum = item.pageNum; currentItemStart = item.index; }
      currentText += item.text + " ";
      currentItemEnd = item.index;
      prevY = item.y;
      if (currentText.length > MAX_CHUNK_CHARS) flushSentence();
    }
  }
  flush();
  return chunks;
}

const chunks = chunkPages(pages);
console.log(`\n=== CHUNKS: ${chunks.length} ===\n`);
for (const c of chunks) {
  const heading = c.headingText ?? "(none)";
  console.log(`[Page ${c.pageNum}] tag=${c.sectionTag}, heading="${heading}", ${c.text.length} chars`);
  console.log(`  text preview: ${c.text.slice(0, 80)}...`);
}

// ── Call LLM for first 3 chunks ──
const EXTRACTION_PROMPT = `You are a research analyst. Scan the given academic paper section and mark important sentences.
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
Return JSON: {"highlights": [{"exact_text": "...", "type": "motivation|key_step|contribution"}]}`;

console.log(`\n=== LLM CALLS (first 3 chunks) ===\n`);

const testChunks = [chunks[2], chunks[5], chunks[9], chunks[25]].filter(Boolean);  // Abstract, Introduction, Model Architecture, Results
for (const chunk of testChunks) {
  const sectionLabel = chunk.headingText || chunk.sectionTag;
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: `Section: ${sectionLabel}\n\n${chunk.text}` },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 1024,
    enable_thinking: false,
    thinking_budget_tokens: 512,
  };

  console.log(`--- Chunk: page=${chunk.pageNum}, section="${sectionLabel}" ---`);
  try {
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.error(`  LLM error ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      continue;
    }
    const json = await resp.json();
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed;
    try { parsed = JSON.parse(content); } catch { console.log(`  Failed to parse: ${content.slice(0, 200)}`); continue; }
    const highlights = (parsed.highlights || []).filter(h => h.exact_text?.trim().length >= 10);
    console.log(`  → ${highlights.length} highlights:`);
    for (const h of highlights) {
      const text = h.exact_text;
      const complete = /[.!?]$/.test(text.trim());
      console.log(`    [${h.type}] ${complete ? "✓" : "✗ INCOMPLETE"} (${text.length} chars) ${text.slice(0, 100)}${text.length > 100 ? "..." : ""}`);
    }
  } catch (e) {
    console.error(`  Fetch error: ${e.message}`);
  }
  console.log();
}

console.log("=== DONE ===");
