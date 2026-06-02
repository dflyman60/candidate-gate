/** Evidence depth and resume structure analysis. */

import { analyzeLegitimacy } from "./legitimacy.js";
import {
  requiresTechnicalAnchors,
  resumeMeetsTechnicalAnchors,
  criterionAnchorTokens,
} from "./legitimacy-utils.js";

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

const GENERIC_RESUME_TOKENS = new Set([
  "scheduler", "scheduling", "project", "experience", "construction", "epc", "baseline",
  "schedule", "schedules", "engineer", "engineering", "controls", "planning", "managed",
  "responsible", "developed", "years", "energy", "power", "next", "era", "renewable",
  "solar", "wind", "utility", "capital", "portfolio", "team", "lead", "led",
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

export function normalizeSnippetKey(snippet) {
  if (!snippet) return "";
  return snippet.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 160);
}

/** Mark shared excerpts so the UI can collapse duplicate quotes. */
export function annotateSnippetGroups(results) {
  const counts = new Map();
  const rankByKey = new Map();
  for (const r of results) {
    if (!r.snippet) continue;
    const key = normalizeSnippetKey(r.snippet);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const r of results) {
    if (!r.snippet) continue;
    const key = normalizeSnippetKey(r.snippet);
    r.snippetGroupSize = counts.get(key) || 1;
    const rank = (rankByKey.get(key) || 0) + 1;
    rankByKey.set(key, rank);
    r.snippetGroupRank = rank;
  }
}

export function findBestSnippet(resumeText, criterionText, domainPack, usedSnippetKeys = null) {
  const keywords = expandSearchTerms(criterionText, domainPack);
  const sentences = extractSentences(resumeText);
  const candidates = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    const lower = trimmed.toLowerCase();
    const matchedTokens = keywords.filter((k) => tokenMatchInText(k, lower));
    if (matchedTokens.length === 0) continue;
    const section = inferSection(resumeText, trimmed);
    if (isDisallowedEvidenceBlock(trimmed, section)) continue;

    const score = matchedTokens.length / keywords.length;
    const signals = detectEvidenceSignals(trimmed, section);
    const overlap = meaningfulOverlap(criterionText, trimmed);
    const phrase = phraseOverlapInSnippet(criterionText, trimmed);
    candidates.push({
      snippet: trimmed,
      score,
      section,
      signals,
      matchedTokens,
      overlap,
      phrase,
    });
  }

  const expLineCandidates = findExperienceSectionCandidates(resumeText, criterionText, domainPack);
  for (const c of expLineCandidates) {
    if (!candidates.some((x) => x.snippet === c.snippet)) candidates.push(c);
  }

  if (!candidates.length) return null;

  const viable = candidates.filter((c) => passesMatchQuality(criterionText, c));
  let pool = viable.filter((c) => !isDisallowedEvidenceBlock(c.snippet, c.section));
  pool = pool.filter((c) => {
    if (!requiresTechnicalAnchors(criterionText)) return true;
    if (!resumeMeetsTechnicalAnchors(criterionText, c.snippet)) return false;
    if (c.section === "experience") return true;
    return Boolean(c.phrase) || c.overlap >= 0.45;
  });

  if (!pool.length) return null;

  const sortFn = (a, b) =>
    rankCandidate(criterionText, b, usedSnippetKeys) - rankCandidate(criterionText, a, usedSnippetKeys) ||
    b.overlap - a.overlap ||
    (b.phrase ? 1 : 0) - (a.phrase ? 1 : 0) ||
    b.signals.length - a.signals.length ||
    b.score - a.score;

  const expMatches = pool.filter((c) => c.section === "experience");
  if (expMatches.length) {
    expMatches.sort(sortFn);
    return expMatches[0];
  }

  const bodyMatches = pool.filter((c) => c.section === "body");
  if (bodyMatches.length) {
    bodyMatches.sort(sortFn);
    return bodyMatches[0];
  }

  const summaryMatches = pool.filter(
    (c) =>
      c.section === "summary" &&
      (c.phrase || c.overlap >= 0.45 || (c.overlap >= 0.34 && c.signals.length >= 1))
  );
  if (summaryMatches.length) {
    summaryMatches.sort(sortFn);
    return summaryMatches[0];
  }

  return null;
}

function passesMatchQuality(criterionText, candidate) {
  const { snippet, score, matchedTokens, overlap, phrase } = candidate;
  if (requiresTechnicalAnchors(criterionText) && !resumeMeetsTechnicalAnchors(criterionText, snippet)) {
    return false;
  }
  if (requiresTechnicalAnchors(criterionText)) {
    if (phrase && resumeMeetsTechnicalAnchors(criterionText, snippet)) return true;
    if (technicalAnchorOverlap(criterionText, snippet) >= 0.34) return true;
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

function technicalAnchorOverlap(criterionText, snippet) {
  const anchors = criterionAnchorTokens(criterionText);
  if (!anchors.length) return 0;
  const resume = (snippet || "").toLowerCase();
  const hits = anchors.filter((a) => resume.includes(a)).length;
  return hits / anchors.length;
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

export function assessCriterionEvidence(
  resumeText,
  criterionText,
  domainPack,
  jdRaw = "",
  usedSnippetKeys = null
) {
  const snippetResult = findBestSnippet(resumeText, criterionText, domainPack, usedSnippetKeys);
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

  const { snippet, section, signals, matchedTokens, phrase, overlap } = snippetResult;
  const overlapVal = overlap ?? meaningfulOverlap(criterionText, snippet);
  const rawConfidence = scoreConfidence(section, signals, snippet, overlapVal, phrase, matchedTokens);
  const legitimacy = analyzeLegitimacy(criterionText, snippet, section, signals, jdRaw, domainPack);
  const phraseOnResume = phrase || phraseOverlapInSnippet(criterionText, snippet);
  const headerOnlyRejected = isDisallowedEvidenceBlock(snippet, section);
  const notStatedOnResume =
    legitimacy.tier === "not-on-resume" || headerOnlyRejected || section === "header";
  const finalized = notStatedOnResume
    ? { confidence: "none", confidenceLabel: "Not stated on resume", matched: false }
    : finalizeConfidence(rawConfidence, criterionText, {
        snippet,
        section,
        signals,
        overlap: overlapVal,
        phrase: phraseOnResume,
        matchedTokens,
      }, legitimacy);

  return {
    text: criterionText,
    matched: notStatedOnResume ? false : finalized.matched,
    confidence: notStatedOnResume ? "none" : finalized.confidence,
    confidenceLabel: notStatedOnResume ? "Not stated on resume" : finalized.confidenceLabel,
    criterionOverlap: overlapVal,
    snippet: notStatedOnResume ? null : snippet,
    incidentalSnippet: false,
    section,
    sectionLabel: sectionLabel(section, snippet),
    signals,
    matchedTokens: matchedTokens || [],
    phraseOnResume: notStatedOnResume ? null : phraseOnResume,
    verificationQuestion: buildVerificationQuestion(criterionText, snippet, legitimacy, {
      phraseOnResume: notStatedOnResume ? null : phraseOnResume,
      matchedTokens,
      notStatedOnResume,
    }),
    legitimacy,
  };
}

function rankCandidate(criterionText, candidate, usedSnippetKeys) {
  const spec = criterionSpecificScore(criterionText, candidate);
  const key = normalizeSnippetKey(candidate.snippet);
  const usedPenalty = usedSnippetKeys?.has(key) ? -0.45 : 0;
  return spec + usedPenalty;
}

function criterionSpecificScore(criterionText, candidate) {
  const { matchedTokens, overlap, phrase } = candidate;
  if (phrase) return 0.88 + Math.min(0.12, phrase.length / 100);
  const strongHits = (matchedTokens || []).filter(
    (t) => !WEAK_MATCH_TOKENS.has(t) && !GENERIC_RESUME_TOKENS.has(t)
  );
  const genericOnly =
    (matchedTokens || []).length > 0 && strongHits.length === 0;
  let score = overlap ?? meaningfulOverlap(criterionText, candidate.snippet);
  if (genericOnly) score *= 0.25;
  else if (strongHits.length >= 2) score += 0.18;
  return score;
}

function finalizeConfidence(raw, criterionText, ctx, legitimacy) {
  const { snippet, section, signals, overlap, phrase, matchedTokens } = ctx;
  const echo = legitimacy.jdEchoPercent ?? 0;
  const tier = legitimacy.tier;
  const intent = legitimacy.intent || [];
  const reqMissing = intent.filter((i) => i.id.startsWith("req-") && i.status === "missing");

  const toRelevant = () => ({
    confidence: "relevant",
    confidenceLabel: "Relevant role — verify duty",
    matched: true,
  });

  if (tier === "likely-mirrored" || echo >= 55) return toRelevant();
  if (reqMissing.length > 0) return toRelevant();
  if (!phrase && overlap < 0.28) return toRelevant();

  if (raw === "high") {
    const hasStrong = signals.some((s) =>
      ["employer", "dates", "deliverable", "project context", "metrics"].includes(s)
    );
    const strongHits = (matchedTokens || []).filter(
      (t) => !WEAK_MATCH_TOKENS.has(t) && !GENERIC_RESUME_TOKENS.has(t)
    );
    if (!phrase && overlap < 0.42) return toRelevant();
    if (echo >= 40) return toRelevant();
    if (!hasStrong && !phrase) return toRelevant();
    if (strongHits.length === 0 && !phrase) return toRelevant();
    return {
      confidence: "high",
      confidenceLabel: confidenceLabel("high", section, snippet),
      matched: true,
    };
  }

  if (raw === "medium" && (echo >= 45 || (!phrase && overlap < 0.32))) return toRelevant();

  return {
    confidence: raw,
    confidenceLabel: confidenceLabel(raw, section, snippet),
    matched: raw !== "none",
  };
}

function scoreConfidence(section, signals, snippet, overlap = 0, phrase = null, matchedTokens = []) {
  const signalCount = signals.length;
  const headerLike = section === "summary" || section === "header" || isLikelyHeaderBlock(snippet);
  const strongHits = (matchedTokens || []).filter(
    (t) => !WEAK_MATCH_TOKENS.has(t) && !GENERIC_RESUME_TOKENS.has(t)
  );

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
    if (phrase || overlap >= 0.45) {
      if (signalCount >= 2 && hasStrong && strongHits.length >= 1) return "high";
      if (hasStrong || strongHits.length >= 1) return "medium";
    }
    if (signalCount >= 2 && hasStrong && strongHits.length >= 2 && overlap >= 0.38) return "high";
    if (signalCount >= 1 && hasStrong && strongHits.length >= 1) return "medium";
    if (signalCount >= 1 || strongHits.length >= 1) return "medium";
    return "low";
  }

  if (signalCount >= 2) return "medium";
  if (signalCount >= 1) return "medium";
  return "low";
}

function isLikelyHeaderBlock(text) {
  return isContactHeavyBlock(text);
}

/** Contact/header blocks are never valid requirement evidence. */
export function isDisallowedEvidenceBlock(snippet, section) {
  if (!snippet) return true;
  if (section === "header") return true;
  if (isContactHeavyBlock(snippet)) return true;
  return false;
}

function isContactHeavyBlock(text) {
  if (!text || text.length < 15) return false;
  let score = 0;
  if (/@|gmail\.|yahoo\.|outlook\.|hotmail\.|\.com\b/i.test(text)) score += 2;
  if (/\b\d{3}[-.\s)]?\s*\d{3}[-.\s]\d{4}\b/.test(text)) score += 2;
  if (/\b(?:TX|CA|NY|FL|VA|MD|GA|IL)\s+\d{5}\b/i.test(text)) score += 1;
  if (/\bEducation\s*:/i.test(text) && (/@|\d{3}[-.\s)]?\s*\d{3}/.test(text))) return true;
  if (/\bPMP\b|\bPE\b|\(US\s+CITIZEN\)/i.test(text) && score > 0) score += 1;
  if (score >= 2) return true;
  if (score >= 1 && text.length < 320 && !hasJobActionVerbs(text)) return true;
  return false;
}

function hasJobActionVerbs(text) {
  return /\b(?:managed|led|developed|created|built|updated|prepared|analyzed|coordinated|responsible|implemented|delivered|supported|performed|completed)\b/i.test(
    text
  );
}

function findExperienceSectionCandidates(resumeText, criterionText, domainPack) {
  const keywords = expandSearchTerms(criterionText, domainPack);
  const lines = resumeText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let section = "header";
  const out = [];

  for (const line of lines) {
    if (SUMMARY_SECTION_RE.test(line)) {
      section = "summary";
      continue;
    }
    if (SKILLS_SECTION_RE.test(line)) {
      section = "skills";
      continue;
    }
    if (/^(?:experience|employment|work\s*history|professional\s*experience)\s*:?\s*$/i.test(line)) {
      section = "experience";
      continue;
    }
    if (/^(?:education|certifications?|licenses?)\s*:?\s*$/i.test(line)) {
      section = "education";
      continue;
    }
    if (section !== "experience" || line.length < 20) continue;
    if (isContactHeavyBlock(line)) continue;

    const lower = line.toLowerCase();
    const matchedTokens = keywords.filter((k) => tokenMatchInText(k, lower));
    if (!matchedTokens.length) continue;

    out.push({
      snippet: line,
      score: matchedTokens.length / keywords.length,
      section: "experience",
      signals: detectEvidenceSignals(line, "experience"),
      matchedTokens,
      overlap: meaningfulOverlap(criterionText, line),
      phrase: phraseOverlapInSnippet(criterionText, line),
    });
  }
  return out;
}

function detectEvidenceSignals(text, section = "") {
  const signals = [];
  if (DATE_RE.test(text)) signals.push("dates");
  if (YEARS_RE.test(text)) signals.push("tenure");
  if (section === "experience" && EMPLOYER_RE.test(text)) signals.push("employer");
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

  const snippetReuse = new Map();
  for (const r of mustResults) {
    if (!r.snippet) continue;
    const key = normalizeSnippetKey(r.snippet);
    snippetReuse.set(key, (snippetReuse.get(key) || 0) + 1);
  }
  const maxReuse = Math.max(0, ...snippetReuse.values());
  if (maxReuse >= 4) {
    flags.push({
      severity: "high",
      title: "One experience bullet reused for many requirements",
      detail: `The same resume excerpt was used for ${maxReuse} must-haves with loose overlap. Treat as role fit, not duty-specific proof.`,
    });
  }

  const relevantOnly = mustResults.filter((r) => r.confidence === "relevant").length;
  if (mustResults.length >= 4 && relevantOnly >= Math.ceil(mustResults.length * 0.55)) {
    flags.push({
      severity: "medium",
      title: "Most must-haves are role-related only",
      detail:
        "Resume shows a shared job block but not duty-specific language for many requirements. Use the screen kit to verify each duty.",
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

  const notOnResume = mustResults.filter((r) => r.confidence === "none" || !r.snippet).length;
  if (mustResults.length >= 3 && notOnResume >= Math.ceil(mustResults.length * 0.5)) {
    flags.push({
      severity: "medium",
      title: "Requirements not evidenced in experience bullets",
      detail:
        "Many must-haves are not supported by job history text (contact/header/summary matches are ignored). Use the screen kit to verify claims live.",
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
  if (meta.notStatedOnResume) {
    return `Posting requires: "${topic}". The resume does not state drawings, specifications, or SOW analysis—only general scheduler/EPC language. Ask for a project where they reviewed drawings and specs to build a baseline schedule.`;
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
  if (c === "low" && section === "skills") {
    return "Low — skills list only";
  }
  if (c === "low" && section === "summary" && !isContactHeavyBlock(snippet)) {
    return "Low — summary only (verify in screen)";
  }
  return {
    high: "High — substantiated",
    medium: "Medium — partial context",
    relevant: "Relevant role — verify duty",
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
  const merged = [...bullets, ...sentences];
  const expanded = [];
  for (const chunk of merged) {
    if (chunk.length > 350) expanded.push(...splitMashedBlock(chunk));
    else expanded.push(chunk);
  }
  return [...new Set(expanded)].filter((s) => s.length > 15 && !isContactHeavyBlock(s));
}

function splitMashedBlock(text) {
  const parts = [];
  const re = /(?:SUMMARY|EXPERIENCE|EMPLOYMENT|WORK\s*HISTORY|EDUCATION|SKILLS|CERTIFICATIONS?)\s*:?\s*/gi;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last + 20) parts.push(text.slice(last, m.index).trim());
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last).trim());
  return parts.filter((p) => p.length > 20);
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
  return { high: 1, medium: 0.55, relevant: 0.28, low: 0.2, none: 0 }[confidence] ?? 0;
}
