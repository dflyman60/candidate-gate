const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

let pdfJsReady = null;

export function loadPdfJs() {
  if (pdfJsReady) return pdfJsReady;
  if (window.pdfjsLib) {
    configurePdfJs();
    pdfJsReady = Promise.resolve(window.pdfjsLib);
    return pdfJsReady;
  }
  pdfJsReady = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PDFJS_CDN;
    script.onload = () => {
      configurePdfJs();
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error("Failed to load PDF.js"));
    document.head.appendChild(script);
  });
  return pdfJsReady;
}

function configurePdfJs() {
  const lib = window.pdfjsLib;
  if (lib?.GlobalWorkerOptions) {
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
}

export async function extractTextFromPdf(file) {
  const pdfjsLib = await loadPdfJs();
  const data = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const parts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(" ");
    parts.push(pageText);
  }
  return normalizeResumeText(parts.join("\n"));
}

function normalizeResumeText(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

import { activeCriteria } from "./criteria.js";

export function summarizeResumeClaims(resumeText, requisition, domainPack) {
  const lines = resumeText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 280);

  const keywords = [
    ...(domainPack.keywordHints?.must || []),
    ...(domainPack.keywordHints?.preferred || []),
    ...activeCriteria(requisition.mustHaves).map((m) => m.text),
    ...activeCriteria(requisition.preferred).map((p) => p.text),
  ]
    .map((k) => k.toLowerCase())
    .filter((k, i, arr) => arr.indexOf(k) === i);

  const scored = lines
    .map((line) => {
      const lower = line.toLowerCase();
      const hits = keywords.filter((k) => lower.includes(k) || tokenOverlap(lower, k) > 0.5);
      return { line, hits: hits.length };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 8);

  if (scored.length) return scored.map((s) => s.line);

  const rolePatterns = [
    /(?:senior |lead |principal )?(?:project )?scheduler/i,
    /cost engineer/i,
    /project controls/i,
    /planning engineer/i,
  ];
  const roles = [];
  for (const pat of rolePatterns) {
    const m = resumeText.match(new RegExp(`.{0,40}${pat.source}.{0,60}`, "i"));
    if (m) roles.push(m[0].trim());
  }
  if (roles.length) return roles.slice(0, 5);

  return [resumeText.slice(0, 220) + (resumeText.length > 220 ? "…" : "")];
}

function tokenOverlap(a, b) {
  const ta = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  const tb = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 2));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}
