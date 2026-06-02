/** Locate evidence snippets in extracted resume text and render highlights. */

export function findSnippetRange(resumeText, snippet) {
  if (!resumeText || !snippet) return null;
  const needle = snippet.trim();
  if (!needle) return null;

  let start = resumeText.indexOf(needle);
  if (start >= 0) return { start, end: start + needle.length };

  const lower = resumeText.toLowerCase();
  const needleLower = needle.toLowerCase();
  start = lower.indexOf(needleLower);
  if (start >= 0) return { start, end: start + needle.length };

  const collapsedResume = collapseWs(resumeText);
  const collapsedNeedle = collapseWs(needle);
  if (collapsedNeedle.length >= 12) {
    const cStart = collapsedResume.indexOf(collapsedNeedle);
    if (cStart >= 0) {
      return mapCollapsedRange(resumeText, collapsedResume, cStart, cStart + collapsedNeedle.length);
    }
  }

  for (let len = Math.min(needle.length, 100); len >= 24; len -= 4) {
    for (let i = 0; i <= needle.length - len; i += Math.max(4, Math.floor(len / 3))) {
      const probe = needle.slice(i, i + len);
      start = lower.indexOf(probe.toLowerCase());
      if (start >= 0) return { start, end: start + probe.length };
    }
  }

  return null;
}

function collapseWs(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Map a range in whitespace-collapsed text back to the original string. */
function mapCollapsedRange(original, collapsed, cStart, cEnd) {
  let ci = 0;
  let oi = 0;
  let start = -1;
  let end = -1;

  while (oi < original.length && ci <= cEnd) {
    if (/\s/.test(original[oi])) {
      if (ci > 0 && collapsed[ci - 1] === " " && collapsed[ci] !== " ") {
        ci++;
      }
      oi++;
      continue;
    }
    if (ci === cStart && start < 0) start = oi;
    if (ci === cEnd) {
      end = oi;
      break;
    }
    if (original[oi].toLowerCase() === collapsed[ci]) ci++;
    oi++;
  }

  if (start >= 0 && end < 0) end = original.length;
  if (start >= 0 && end > start) return { start, end };
  return null;
}

export function renderResumeDocument(resumeText, highlight = null) {
  if (!resumeText) {
    return `<p class="muted">No resume loaded.</p>`;
  }

  if (!highlight || highlight.start < 0 || highlight.end <= highlight.start) {
    return `<div class="resume-doc-body">${escapeHtml(resumeText)}</div>`;
  }

  const { start, end } = highlight;
  const before = resumeText.slice(0, start);
  const match = resumeText.slice(start, end);
  const after = resumeText.slice(end);

  return `<div class="resume-doc-body">${escapeHtml(before)}<mark class="evidence-highlight" id="resume-evidence-mark">${escapeHtml(match)}</mark>${escapeHtml(after)}</div>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
