/** Evidence depth and resume structure analysis. */

import { analyzeLegitimacy } from "./legitimacy.js";

const DATE_RE = /\b(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}\b|\b(?:19|20)\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\b/i;
const YEARS_RE = /\b\d{1,2}\+?\s*(?:years?|yrs?)\b/i;
const METRICS_RE = /\b\d[\d,]*\+?\s*(?:activities|resources|projects|mw|mwh|\$|million|billion|k)\b/i;
const EMPLOYER_RE = /\b(?:at|for|with)\s+[A-Z][A-Za-z0-9&.,'\- ]{2,40}\b/;
const PROJECT_RE = /\b(?:epc|data\s*center|nuclear|industrial|construction|refinery|pipeline|power\s*plant|infrastructure)\b/i;
const DELIVERABLE_RE =
  /\b(?:baseline|recovery\s*schedule|schedule\s*update|cost\s*report|earned\s*value|wbs|lookahead|critical\s*path|drawing|drawings|blueprint|markup)\b/i;

const SKILLS_SECTION_RE = /^(?:skills|technical\s*skills|competencies|core\s*competencies|tools|software)\s*:?\s*$/i;
const SUMMARY_SECTION_RE = /^(?:summary|profile|objective|professional\s*summary)\s*:?\s*$/i;

const BOILERPLATE_CRITERION_RE =
  /(?:be\s+)?responsible\s+for|departmental\s+duties|as\s+necessary|other\s+(?:duties|assignments)|perform\s+other|equal\s+opportunity|eeo|work\s+environment/i;

const WEAK_MATCH_TOKENS = new Set([
  "responsible", "special", "other", "departmental", "duties", "necessary", "various",
  "assist", "support", "help", "ensure", "ability", "skills", "including", "related",
  "assigned", "general", "additional", "various", "flexible", "team", "work",
]);

export function splitResumeSegments(resumeText) {
  const lines = resumeText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const segments = [];
  let currentSection = "body";
  let summaryEnd = Math.min(600, resumeText.length);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SUMMARY_SECTION_RE.test(line)) {
      currentSection = "summary";
      continue;
    }
    if (SKILLS_SECTION_RE.test(line)) {
      currentSection = "skills";
      continue;
    }
    if (/^(?:experience|employment|work\s*history|professional\s*experience)\s*:?\s*$/i.test(line)) {
      currentSection = "experience";
      continue;
    }
    segments.push({ line, section: currentSection, index: i });
  }

  if (!segments.length) {
    return [{ line: resumeText, section: "body", index: 0 }];
  }
  return { segments, summaryEnd };
}

export function findBestSnippet(resumeText, criterionText, domainPack) {
  const keywords = expandSearchTerms(criterionText, domainPack);
  const sentences = extractSentences(resumeText);
  const candidates = [];

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    const matchedTokens = keywords.filter((k) => tokenMatchInText(k, lower));
    if (matchedTokens.length === 0) continue;
    const score = matchedTokens.length / keywords.length;
    const section = inferSection(resumeText, sentence);
    const signals = detectEvidenceSignals(sentence);
    const overlap = meaningfulOverlap(criterionText, sentence);
    const phrase = phraseOverlapInSnippet(criterionText, sentence);
    candidates.push({
      snippet: sentence.trim(),
      score,
      section,
      signals,
      matchedTokens,
      overlap,
      phrase,
    });
  }

  if (!candidates.length) return null;

  const viable = candidates.filter((c) => passesMatchQuality(criterionText, c));
  const pool = viable.length ? viable : [];

  if (!pool.length) return null;

  const expMatches = pool.filter((c) => c.section === "experience");
  const sortFn = (a, b) =>
    b.overlap - a.overlap ||
    (b.phrase ? 1 : 0) - (a.phrase ? 1 : 0) ||
    b.signals.length - a.signals.length ||
    b.score - a.score;

  if (expMatches.length) {
    expMatches.sort(sortFn);
    return expMatches[0];
  }

  pool.sort(sortFn);
  return pool[0];
}

function passesMatchQuality(criterionText, candidate) {
  const { snippet, score, matchedTokens, overlap, phrase } = candidate;
  if (requiresDomainAnchor(criterionText) && !domainAnchorInSnippet(criterionText, snippet)) {
    return false;
  }
  if (phrase) return true;
  if (overlap >= 0.34) return true;
  if (isBoilerplateCriterion(criterionText)) return false;
  const strongHits = matchedTokens.filter((t) => !WEAK_MATCH_TOKENS.has(t));
  if (strongHits.length >= 2) return true;
  if (strongHits.length >= 1 && score >= 0.45) return true;
  return score >= 0.5 && strongHits.length >= 1;
}

function requiresDomainAnchor(criterionText) {
  return /drawing|blueprint|cad|autocad|interpret.*(?:drawing|engineer)/i.test(criterionText);
}

function domainAnchorInSnippet(criterionText, snippet) {
  const lower = (snippet || "").toLowerCase();
  if (/drawing/i.test(criterionText)) return /\bdrawings?\b|blueprint|cad|autocad|markup/i.test(lower);
  return true;
}

export function isBoilerplateCriterion(text) {
  return BOILERPLATE_CRITERION_RE.test(text);
}

function meaningfulOverlap(criterionText, snippet) {
  const crit = significantTokens(criterionText).filter((t) => !WEAK_MATCH_TOKENS.has(t));
  if (!crit.length) return 0;
  const snip = snippet.toLowerCase();
  const hits = crit.filter((t) => tokenMatchInText(t, snip));
  return hits.length / crit.length;
}

function phraseOverlapInSnippet(criterionText, snippet) {
  const words = criterionText
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !WEAK_MATCH_TOKENS.has(w));
  const snip = snippet.toLowerCase();
  for (let len = Math.min(words.length, 5); len >= 2; len--) {
    for (let i = 0; i <= words.length - len; i++) {
      const phrase = words.slice(i, i + len).join(" ");
      if (phrase.length >= 10 && snip.includes(phrase)) return phrase;
    }
  }
  return null;
}

function tokenMatchInText(token, textLower) {
  if (!token || token.length < 3) return false;
  if (textLower.includes(token)) return true;
  if (token.endsWith("s") && token.length > 4 && textLower.includes(token.slice(0, -1))) {
    const stem = token.slice(0, -1);
    return new RegExp(`\\b${escapeRegex(stem)}\\b`).test(textLower);
  }
  return false;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function assessCriterionEvidence(resumeText, criterionText, domainPack, jdRaw = "") {
  const snippetResult = findBestSnippet(resumeText, criterionText, domainPack);
  if (!snippetResult) {
    const legitimacy = analyzeLegitimacy(criterionText, null, null, [], jdRaw, domainPack);
    return {
      text: criterionText,
      matched: false,
      confidence: "none",
      confidenceLabel: "Not found",
      snippet: null,
      section: null,
      signals: [],
      verificationQuestion: buildVerificationQuestion(criterionText, null),
      legitimacy,
    };
  }

  const { snippet, section, signals, matchedTokens, phrase } = snippetResult;
  const confidence = scoreConfidence(section, signals, snippet);
  const matched = confidence !== "none";
  const legitimacy = analyzeLegitimacy(criterionText, snippet, section, signals, jdRaw, domainPack);
  const phraseOnResume = phrase || phraseOverlapInSnippet(criterionText, snippet);

  return {
    text: criterionText,
    matched,
    confidence,
    confidenceLabel: confidenceLabel(confidence, section, snippet),
    snippet,
    section,
    sectionLabel: sectionLabel(section, snippet),
    signals,
    matchedTokens: matchedTokens || [],
    phraseOnResume,
    verificationQuestion: buildVerificationQuestion(criterionText, snippet, legitimacy, {
      phraseOnResume,
      matchedTokens,
    }),
    legitimacy,
  };
}

function scoreConfidence(section, signals, snippet) {
  const signalCount = signals.length;
  const headerLike = section === "summary" || section === "header" || isLikelyHeaderBlock(snippet);

  if (section === "skills") {
    return signalCount > 0 ? "low" : "none";
  }

  if (headerLike) {
    return signalCount > 0 || significantTokens(snippet).length > 0 ? "low" : "none";
  }

  if (section === "experience") {
    const hasStrong = signals.some((s) =>
      ["employer", "dates", "deliverable", "project context", "metrics"].includes(s)
    );
    if (signalCount >= 2 && hasStrong) return "high";
    if (signalCount >= 1 && hasStrong) return "medium";
    if (signalCount >= 1) return "medium";
    return "low";
  }

  if (signalCount >= 2) return "medium";
  if (signalCount >= 1) return "medium";
  return "low";
}

function isLikelyHeaderBlock(text) {
  if (!text) return false;
  if (/@\w+\.\w+/.test(text)) return true;
  if (/\b\d{3}[-.\s)]?\s*\d{3}[-.\s]\d{4}\b/.test(text)) return true;
  const head = text.slice(0, 100);
  if (/(?:PROJECT\s+SCHEDULER|SCHEDULER|COST\s+ENGINEER)/i.test(head) && text.length < 350) return true;
  return false;
}

function detectEvidenceSignals(text) {
  const signals = [];
  if (DATE_RE.test(text)) signals.push("dates");
  if (YEARS_RE.test(text)) signals.push("tenure");
  if (EMPLOYER_RE.test(text)) signals.push("employer");
  if (PROJECT_RE.test(text)) signals.push("project context");
  if (DELIVERABLE_RE.test(text)) signals.push("deliverable");
  if (METRICS_RE.test(text)) signals.push("metrics");
  return signals;
}

function inferSection(resumeText, sentence) {
  const idx = resumeText.indexOf(sentence);
  if (idx < 0) return "body";
  if (idx < 400 || isLikelyHeaderBlock(sentence)) return "header";
  if (idx < 700) return "summary";
  const before = resumeText.slice(0, idx).toLowerCase();
  const skillsIdx = Math.max(before.lastIndexOf("skills"), before.lastIndexOf("competencies"));
  const expIdx = Math.max(
    before.lastIndexOf("experience"),
    before.lastIndexOf("employment"),
    before.lastIndexOf("work history")
  );
  if (skillsIdx > expIdx && skillsIdx > -1) return "skills";
  if (expIdx > -1) return "experience";
  return "body";
}

export function runConsistencyChecks(resumeText, mustResults, requisition) {
  const flags = [];
  const resume = resumeText.toLowerCase();
  const summaryZone = resumeText.slice(0, Math.min(800, resumeText.length)).toLowerCase();

  const mustKeywords = requisition.mustHaves.flatMap((m) => significantTokens(m.text));
  if (mustKeywords.length) {
    const inSummary = mustKeywords.filter((k) => summaryZone.includes(k)).length;
    const ratio = inSummary / mustKeywords.length;
    if (ratio >= 0.7 && mustResults.filter((r) => r.confidence === "high").length === 0) {
      flags.push({
        severity: "medium",
        title: "Must-haves clustered in summary/skills only",
        detail: "Keywords appear upfront but lack substantiated experience bullets. Common with AI-tailored resumes.",
      });
    }
  }

  const skillsMatch = resume.match(/(?:skills|competencies|technical)[:\s]+([^\n]{20,400})/i);
  if (skillsMatch) {
    const block = skillsMatch[1].toLowerCase();
    const hits = mustKeywords.filter((k) => block.includes(k)).length;
    if (mustKeywords.length && hits / mustKeywords.length >= 0.65) {
      flags.push({
        severity: "medium",
        title: "Skills block mirrors must-have list",
        detail: "Many required terms appear together in a skills list without matching depth in experience.",
      });
    }
  }

  const lines = resumeText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 25);
  const seen = new Map();
  for (const line of lines) {
    const key = line.toLowerCase().replace(/\s+/g, " ");
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  if (dupes.length) {
    flags.push({
      severity: "low",
      title: "Repeated bullet language",
      detail: `${dupes.length} duplicate or near-duplicate line(s) detected.`,
    });
  }

  const highCount = mustResults.filter((r) => r.confidence === "high").length;
  const lowOnly = mustResults.filter((r) => r.matched && (r.confidence === "low")).length;
  if (mustResults.length && lowOnly === mustResults.filter((r) => r.matched).length && lowOnly >= 3) {
    flags.push({
      severity: "high",
      title: "All matches are weak evidence",
      detail: "Every must-have hit is keyword-only (summary/skills) with no dated project context.",
    });
  }

  if (mustResults.length >= 3 && highCount === 0) {
    flags.push({
      severity: "medium",
      title: "No high-confidence must-have evidence",
      detail: "Resume mentions requirements but does not tie them to employers, dates, or deliverables.",
    });
  }

  return flags;
}

function buildVerificationQuestion(criterionText, snippet, legitimacy, meta = {}) {
  const topic = criterionText.replace(/\.$/, "");
  if (!snippet) {
    return `This job requirement is not clearly supported on the resume: "${topic}". Ask for a specific role, employer, dates, and deliverable.`;
  }
  const phraseOnResume = meta.phraseOnResume;
  const weakOnly =
    isBoilerplateCriterion(criterionText) && !phraseOnResume;
  if (weakOnly) {
    return `The posting includes "${topic}", but that wording does not appear on the resume (any match is incidental). Ask where they performed this duty, with which employer, and what they delivered.`;
  }
  if (legitimacy?.tier === "likely-mirrored") {
    return `The posting requires "${topic}" but the resume only shows overlapping language, not job-level proof. Name employer, project dates, schedule size, and one deliverable—without reading the resume.`;
  }
  if (legitimacy?.tier === "self-reported") {
    if (phraseOnResume) {
      return `The resume states something related to "${topic}" in a summary/header area. Which role and employer was this, and what did you deliver?`;
    }
    const hint = meta.matchedTokens?.length
      ? ` (resume only loosely overlaps on: ${meta.matchedTokens.slice(0, 3).join(", ")})`
      : "";
    return `The posting requires "${topic}", but the resume does not state this clearly${hint}. Ask which job this applied to and for concrete examples.`;
  }
  return `Regarding "${topic}" (resume: ${snippet.slice(0, 80)}…): walk through project scope, schedule size, update cadence, software used, and who validated your work.`;
}

function confidenceLabel(c, section, snippet) {
  if (c === "low" && (section === "header" || section === "summary" || isLikelyHeaderBlock(snippet))) {
    return "Low — header/summary claim";
  }
  if (c === "low" && section === "skills") {
    return "Low — skills list only";
  }
  return {
    high: "High — substantiated",
    medium: "Medium — partial context",
    low: "Low — keyword only",
    none: "Not found",
  }[c] || c;
}

function sectionLabel(section, snippet) {
  if (section === "experience") return "Experience section";
  if (section === "skills") return "Skills section";
  if (section === "header" || isLikelyHeaderBlock(snippet)) return "Header / contact block";
  if (section === "summary") return "Summary section";
  return "Resume body";
}

function extractSentences(text) {
  const bullets = text.split(/\r?\n/).map((l) => l.replace(/^[-•*●▪◦]\s+/, "").trim()).filter((l) => l.length > 15);
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 15);
  return [...new Set([...bullets, ...sentences])];
}

function expandSearchTerms(criterionText, domainPack) {
  const terms = new Set(significantTokens(criterionText));
  const lower = criterionText.toLowerCase();
  const aliasMap = {
    "primavera p6": ["p6", "primavera"],
    "ms project": ["microsoft project", "ms project"],
    cpm: ["critical path"],
    evm: ["earned value", "evms"],
    scheduler: ["scheduling", "project scheduler"],
    "cost engineer": ["cost engineering", "cost control"],
  };
  for (const [key, vals] of Object.entries(aliasMap)) {
    if (lower.includes(key) || vals.some((v) => lower.includes(v))) {
      vals.forEach((v) => terms.add(v));
      key.split(/\W+/).filter((w) => w.length > 2).forEach((w) => terms.add(w));
    }
  }
  (domainPack.keywordHints?.must || []).forEach((k) => {
    if (lower.includes(k)) terms.add(k.toLowerCase());
  });
  return [...terms];
}

function significantTokens(text) {
  const stop = new Set([
    "the", "and", "for", "with", "from", "that", "this", "your", "have", "has", "are", "was", "will",
    "able", "experience", "years", "year", "role", "work", "using", "including", "level", "must", "read",
  ]);
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !stop.has(w));
}

export function confidenceWeight(confidence) {
  return { high: 1, medium: 0.55, low: 0.2, none: 0 }[confidence] ?? 0;
}
