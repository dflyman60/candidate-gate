/** Render resume PDF with in-document evidence highlights (PDF.js). */

import { loadPdfJs } from "./resume-parse.js";
import { findSnippetRange } from "./resume-highlight.js";

export async function createPdfViewer(container, pdfData) {
  await waitForContainerWidth(container);
  const pdfjsLib = await loadPdfJs();
  const data = pdfData instanceof ArrayBuffer ? pdfData : await pdfData.arrayBuffer?.();
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const viewer = new ResumePdfViewer(container, doc, pdfjsLib);
  await viewer.render();
  viewer.attachResize();
  return viewer;
}

function waitForContainerWidth(container, attempts = 30) {
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      const pane = container.closest(".resume-pane");
      const w = container.clientWidth || pane?.clientWidth || 0;
      if (w > 80 || n >= attempts) return resolve();
      n++;
      requestAnimationFrame(tick);
    };
    tick();
  });
}

const ZOOM_MIN = 0.65;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.2;

class ResumePdfViewer {
  constructor(container, doc, pdfjsLib) {
    this.container = container;
    this.doc = doc;
    this.pdfjsLib = pdfjsLib;
    this.pageIndexes = [];
    this.activePage = null;
    this.resizeObserver = null;
    this.rendering = false;
    /** 1 = fit panel width; &gt;1 expands page (scroll to see). */
    this.zoomFactor = 1;
  }

  zoomIn() {
    this.zoomFactor = Math.min(ZOOM_MAX, Math.round((this.zoomFactor + ZOOM_STEP) * 100) / 100);
    return this.rerender();
  }

  zoomOut() {
    this.zoomFactor = Math.max(ZOOM_MIN, Math.round((this.zoomFactor - ZOOM_STEP) * 100) / 100);
    return this.rerender();
  }

  zoomFit() {
    this.zoomFactor = 1;
    return this.rerender();
  }

  getZoomLabel() {
    if (Math.abs(this.zoomFactor - 1) < 0.05) return "Fit width";
    return `${Math.round(this.zoomFactor * 100)}%`;
  }

  getContainerWidth() {
    const w = this.container.clientWidth;
    if (w > 40) return w;
    const pane = this.container.closest(".resume-pane");
    return Math.max(280, (pane?.clientWidth || 360) - 28);
  }

  scaleForPage(page) {
    const base = page.getViewport({ scale: 1 });
    const available = this.getContainerWidth() - 8;
    const fit = available / base.width;
    const fitClamped = Math.min(2.25, Math.max(0.55, fit));
    return fitClamped * this.zoomFactor;
  }

  attachResize() {
    if (typeof ResizeObserver === "undefined") return;
    let resizeTimer = null;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.rendering) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.rerender(), 150);
    });
    this.resizeObserver.observe(this.container);
  }

  async rerender() {
    const target = this.activeHighlight || null;
    await this.render();
    if (target) await this.highlight(target);
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  async render() {
    this.rendering = true;
    this.container.innerHTML = "";
    this.container.classList.add("pdf-viewer-root");
    this.pageIndexes = [];

    for (let n = 1; n <= this.doc.numPages; n++) {
      const page = await this.doc.getPage(n);
      const scale = this.scaleForPage(page);
      const viewport = page.getViewport({ scale });
      const wrap = document.createElement("div");
      wrap.className = "pdf-page-wrap";
      wrap.dataset.page = String(n);
      wrap.style.width = `${viewport.width}px`;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.className = "pdf-page-canvas";

      const highlightLayer = document.createElement("div");
      highlightLayer.className = "pdf-highlight-layer";
      highlightLayer.style.width = `${viewport.width}px`;
      highlightLayer.style.height = `${viewport.height}px`;

      wrap.append(canvas, highlightLayer);
      this.container.appendChild(wrap);

      await page.render({ canvasContext: ctx, viewport }).promise;

      const textContent = await page.getTextContent();
      const index = buildPageTextIndex(textContent.items, viewport, this.pdfjsLib);
      this.pageIndexes.push({ pageNum: n, wrap, highlightLayer, viewport, index });
    }
    this.rendering = false;
  }

  async highlight(target) {
    const opts = typeof target === "string" ? { snippet: target } : target || {};
    this.activeHighlight = opts;
    this.clearHighlights(false);

    const snippet = opts.snippet?.trim();
    if (!snippet) return false;

    let best = null;

    const resumeText = opts.resumeText || "";
    for (const pageEntry of this.pageIndexes) {
      const match = findEvidenceBlockInPage(pageEntry.index, snippet, resumeText);
      if (!match) continue;
      if (
        !best ||
        match.wordScore > best.match.wordScore ||
        (match.wordScore === best.match.wordScore && match.length > best.match.length)
      ) {
        best = { pageEntry, match };
      }
    }

    if (!best) return false;

    const { pageEntry, match } = best;
    this.activePage = pageEntry;
    placeEvidenceStartMarker(pageEntry, match.start, this.pdfjsLib);

    pageEntry.wrap.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  clearHighlights(clearTarget = true) {
    for (const { highlightLayer } of this.pageIndexes) {
      highlightLayer.innerHTML = "";
    }
    this.activePage = null;
    if (clearTarget) this.activeHighlight = null;
  }
}

/** Group PDF text into lines (by Y position) for find-style matching. */
function buildPageTextIndex(items, viewport, pdfjsLib) {
  const rows = [];
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const t = pdfjsLib.Util.transform(viewport.transform, item.transform);
    rows.push({
      item,
      x: t[4],
      y: Math.round(t[5] / 3) * 3,
    });
  }

  rows.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  let group = null;
  for (const row of rows) {
    if (!group || Math.abs(group.y - row.y) > 5) {
      group = { y: row.y, parts: [] };
      lines.push(group);
    }
    group.parts.push(row);
  }

  for (const line of lines) {
    line.parts.sort((a, b) => a.x - b.x);
    line.text = line.parts.map((p) => p.item.str).join(" ");
    line.id = lines.indexOf(line);
  }

  let searchText = "";
  const charToItem = [];

  for (const line of lines) {
    line._hayStart = searchText.length;
    for (const part of line.parts) {
      const item = part.item;
      if (searchText.length) {
        searchText += " ";
        charToItem.push(null);
      }
      for (let c = 0; c < item.str.length; c++) {
        searchText += hayChar(item.str[c]);
        charToItem.push({ item, line, charIndex: c });
      }
    }
    searchText += " ";
    charToItem.push(null);
    line._hayEnd = searchText.length;
  }

  return {
    lines,
    searchText,
    charToItem,
    items,
    viewport,
    pdfjsLib,
  };
}

/** Browser-style find: locate evidence start on the page (tries several anchors). */
function findEvidenceBlockInPage(index, snippet, resumeText = "") {
  const needles = buildSearchNeedles(snippet, resumeText);
  if (!needles.length) return null;

  let best = null;
  for (const needle of needles) {
    const range = findStringInHay(index.searchText, needle);
    if (!range) continue;
    const wordScore = range.wordScore ?? 1;
    if (wordScore < 0.42) continue;
    const cand = {
      start: range.start,
      end: range.end,
      length: range.end - range.start,
      wordScore,
      needleLen: needle.length,
    };
    if (
      !best ||
      wordScore > best.wordScore + 0.04 ||
      (Math.abs(wordScore - best.wordScore) <= 0.04 && cand.needleLen > best.needleLen)
    ) {
      best = cand;
    }
  }

  return best;
}

function buildSearchNeedles(snippet, resumeText) {
  const needles = [];
  const push = (s) => {
    const n = cleanSnippetForSearch(s);
    if (n.length >= 12 && !needles.includes(n)) needles.push(n);
  };

  push(snippet);

  if (resumeText) {
    const range = findSnippetRange(resumeText, snippet);
    if (range) {
      for (const len of [120, 90, 70, 50, 36]) {
        push(resumeText.slice(range.start, Math.min(range.end, range.start + len)));
      }
    }
  }

  const stripped = snippet.replace(/^[\s.…]+/, "");
  if (stripped !== snippet) push(stripped);

  for (let len = Math.min(snippet.length, 110); len >= 24; len -= 12) {
    push(snippet.slice(0, len));
  }

  const dateLine = snippet.match(
    /[A-Za-z0-9][^.!?]{8,90}\d{1,2}\/\d{4}\s*[-–—]\s*(?:current|present)[^.!?]{0,80}/i
  );
  if (dateLine) push(dateLine[0]);

  const employer = snippet.match(
    /(?:^|[\s/])([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){1,5}\s*[-–—]\s*[A-Za-z][^.!?]{6,70})/i
  );
  if (employer) push(employer[1]);

  const juno = snippet.match(/energy resources\s*[-–—]\s*juno beach[^.!?]{0,55}/i);
  if (juno) push(juno[0]);

  if (/nextera/i.test(snippet)) {
    push(snippet.replace(/nextera/gi, "next era"));
  }

  return needles;
}

function placeEvidenceStartMarker(pageEntry, startIndex, pdfjsLib) {
  const point = evidenceStartMarkerRect(
    pageEntry.index,
    startIndex,
    pageEntry.viewport,
    pdfjsLib
  );
  if (!point) return;

  const marker = document.createElement("div");
  marker.className = "pdf-evidence-marker";
  marker.setAttribute("aria-hidden", "true");
  marker.title = "Evidence starts here";
  Object.assign(marker.style, {
    left: `${Math.max(0, point.left - 20)}px`,
    top: `${Math.max(0, point.top - 4)}px`,
  });
  pageEntry.highlightLayer.appendChild(marker);
}

function evidenceStartMarkerRect(index, start, viewport, pdfjsLib) {
  for (let i = start; i < index.charToItem.length; i++) {
    const entry = index.charToItem[i];
    if (!entry) continue;
    return itemHighlightRect(
      { item: entry.item, charStart: entry.charIndex, charEnd: entry.charIndex + 1 },
      viewport,
      pdfjsLib
    );
  }

  for (const line of index.lines) {
    const lineStart = line._hayStart ?? -1;
    const lineEnd = line._hayEnd ?? -1;
    if (start < lineStart || start >= lineEnd || !line.parts.length) continue;
    const item = line.parts[0].item;
    return itemHighlightRect(
      { item, charStart: 0, charEnd: 1 },
      viewport,
      pdfjsLib
    );
  }

  return null;
}

function cleanSnippetForSearch(snippet) {
  return normalizeSearch(
    snippet
      .replace(/^[\s.…]+/, "")
      .replace(/^[\s"“”'‘’]+|[\s"“”'‘’]+$/g, "")
      .replace(/^[\s•●▪◦\-–—]+/, "")
      .replace(/\s*\(near match\)\s*$/i, "")
  );
}

function hayChar(c) {
  const lower = c.toLowerCase();
  if (lower === "\u2013" || lower === "\u2014" || lower === "\u2212") return "-";
  if (lower === "\u2018" || lower === "\u2019") return "'";
  if (lower === "\u201c" || lower === "\u201d") return '"';
  return lower;
}

function findStringInHay(hay, needle) {
  const exact = hay.indexOf(needle);
  if (exact >= 0) {
    return { start: exact, end: exact + needle.length, wordScore: 1 };
  }

  const walked = findByPrefixAndWalk(hay, needle);
  if (walked) return walked;

  const flexible = new RegExp(
    needle
      .split(/\s+/)
      .filter(Boolean)
      .map(escapeRegex)
      .join("\\s+"),
    "i"
  );
  const flex = flexible.exec(hay);
  if (flex) {
    const walked = walkMatchToEnd(hay, flex.index, needle);
    const words = needle.split(/\s+/).filter(Boolean);
    return {
      start: flex.index,
      end: walked.end,
      wordScore: walked.wordsMatched / Math.max(words.length, 1),
    };
  }

  const anchor = findAnchorPrefixStart(hay, needle);
  if (anchor) return anchor;

  const compactHay = hay.replace(/\s/g, "");
  const compactNeedle = needle.replace(/\s/g, "");
  if (compactNeedle.length >= 24) {
    const cIdx = compactHay.indexOf(compactNeedle);
    if (cIdx >= 0) {
      const mapped = mapCompactRange(hay, cIdx, cIdx + compactNeedle.length);
      if (mapped) return { ...mapped, wordScore: 0.85 };
    }
  }

  return null;
}

/** Marker-only: match opening words even when the full phrase walk fails. */
function findAnchorPrefixStart(hay, needle) {
  const words = needle.split(/\s+/).filter((w) => w.length > 2);
  if (words.length < 2) return null;

  for (let count = Math.min(4, words.length); count >= 2; count--) {
    const prefix = words.slice(0, count).join(" ");
    if (prefix.length < 8) continue;
    const idx = hay.indexOf(prefix);
    if (idx >= 0) {
      return { start: idx, end: idx + prefix.length, wordScore: count / words.length };
    }
    const flex = new RegExp(
      prefix
        .split(/\s+/)
        .map(escapeRegex)
        .join("\\s+"),
      "i"
    ).exec(hay);
    if (flex) {
      return { start: flex.index, end: flex.index + flex[0].length, wordScore: count / words.length };
    }
  }

  return null;
}

function findAllStarts(hay, sub) {
  const starts = [];
  if (!sub) return starts;
  let pos = 0;
  while ((pos = hay.indexOf(sub, pos)) >= 0) {
    starts.push(pos);
    pos += 1;
  }
  return starts;
}

function scoreWalkCandidate(needle, words, walked, start, end) {
  const wordScore = walked.wordsMatched / words.length;
  const span = end - start;
  const lenRatio = span / Math.max(needle.length, 1);
  let penalty = 1;
  if (lenRatio > 1.6) penalty *= 0.35;
  else if (lenRatio > 1.25) penalty *= 0.65;
  if (lenRatio < 0.25) penalty *= 0.5;
  return wordScore * penalty;
}

/** Try every occurrence of the opening phrase; pick the best full phrase walk. */
function findByPrefixAndWalk(hay, needle) {
  const words = needle.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;

  let best = null;

  for (let count = 3; count <= Math.min(5, words.length); count++) {
    const prefix = words.slice(0, count).join(" ");
    if (prefix.length < 10) continue;

    for (const start of findAllStarts(hay, prefix)) {
      const walked = walkMatchToEnd(hay, start, needle);
      if (walked.end <= start) continue;

      const wordScore = walked.wordsMatched / words.length;
      const score = scoreWalkCandidate(needle, words, walked, start, walked.end);
      if (!best || score > best.score) {
        best = { start, end: walked.end, score, wordScore };
      }
    }
  }

  if (best && best.wordScore >= 0.42) {
    return { start: best.start, end: best.end, wordScore: best.wordScore };
  }

  return null;
}

function walkMatchToEnd(hay, start, needle) {
  let h = start;
  let n = 0;
  let wordsMatched = 0;
  const totalWords = needle.split(/\s+/).filter(Boolean).length;
  let lastWordMatched = false;

  while (n < needle.length && h < hay.length) {
    const nc = needle[n];
    const hc = hay[h];

    if (nc === " " && hc === " ") {
      if (lastWordMatched) wordsMatched++;
      lastWordMatched = false;
      n++;
      h++;
      while (n < needle.length && needle[n] === " ") n++;
      while (h < hay.length && hay[h] === " ") h++;
      continue;
    }

    if (hc === nc) {
      n++;
      h++;
      lastWordMatched = true;
      continue;
    }

    if (/[.,;:'"()\-–—]/.test(nc)) {
      n++;
      continue;
    }

    if (hc === " " && nc !== " ") {
      h++;
      continue;
    }

    if (/[.,;:'"()\-–—]/.test(hc)) {
      h++;
      continue;
    }

    if (nc === " " && hc !== " ") {
      n++;
      continue;
    }

    break;
  }

  if (lastWordMatched) wordsMatched++;
  if (n >= needle.length) wordsMatched = totalWords;

  return { end: h, progress: n, wordsMatched };
}

function mapCompactRange(hay, cStart, cEnd) {
  let ci = 0;
  let start = -1;
  let end = -1;
  for (let i = 0; i < hay.length; i++) {
    if (/\s/.test(hay[i])) continue;
    if (ci === cStart && start < 0) start = i;
    if (ci === cEnd) {
      end = i;
      break;
    }
    ci++;
  }
  if (start >= 0 && end < 0) end = hay.length;
  if (start >= 0 && end > start) return { start, end };
  return null;
}

/** Highlight text boxes on lines that belong to this evidence phrase. */
function rangeToItemSpans(index, start, end, needle) {
  const lineIds = new Set();

  for (let i = start; i < end && i < index.charToItem.length; i++) {
    const entry = index.charToItem[i];
    if (!entry) continue;
    lineIds.add(entry.line.id);
  }

  const spans = [];
  for (const line of index.lines) {
    if (!lineIds.has(line.id)) continue;
    if (!lineMatchesNeedle(line.text, needle)) continue;
    for (const part of line.parts) {
      spans.push({
        item: part.item,
        charStart: 0,
        charEnd: part.item.str.length,
      });
    }
  }

  if (spans.length) return spans;
  return fallbackLineSpans(index, start, end, needle);
}

function lineMatchesNeedle(lineText, needle) {
  const line = normalizeSearch(lineText);
  const n = normalizeSearch(needle);
  if (!line || line.length < 4) return false;
  if (n.includes(line) || line.includes(n.slice(0, Math.min(n.length, 100)))) return true;

  const lineWords = line.split(/\s+/).filter((w) => w.length > 3);
  const needleWords = new Set(n.split(/\s+/).filter((w) => w.length > 3));
  if (!lineWords.length) return false;
  const hits = lineWords.filter((w) => needleWords.has(w)).length;
  return hits >= Math.min(3, lineWords.length) && hits / lineWords.length >= 0.5;
}

/** If char map has gaps, highlight whole lines overlapping the range. */
function fallbackLineSpans(index, start, end, needle) {
  const spans = [];
  for (const line of index.lines) {
    const lineStart = line._hayStart ?? -1;
    const lineEnd = line._hayEnd ?? -1;
    if (lineStart < 0 || lineEnd < lineStart) continue;
    if (lineEnd < start || lineStart > end) continue;
    if (needle && !lineMatchesNeedle(line.text, needle)) continue;
    for (const part of line.parts) {
      spans.push({
        item: part.item,
        charStart: 0,
        charEnd: part.item.str.length,
      });
    }
  }
  return spans;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function itemHighlightRect(span, viewport, pdfjsLib) {
  const item = span.item;
  const full = item.str || "";
  const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
  const fontHeight = Math.hypot(transform[2], transform[3]);
  const fullWidth = item.width || full.length * fontHeight * 0.55;
  const len = Math.max(full.length, 1);
  const startRatio = span.charStart / len;
  const endRatio = span.charEnd / len;
  const width = Math.max(fullWidth * (endRatio - startRatio), fontHeight * 0.5);

  return {
    left: transform[4] + fullWidth * startRatio,
    top: transform[5] - fontHeight,
    width,
    height: Math.max(fontHeight * 1.15, 8),
  };
}

function normalizeSearch(s) {
  return String(s)
    .toLowerCase()
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
