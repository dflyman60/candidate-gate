/** JD echo, intent checklist, and legitimacy tier per criterion. */

import {
  significantTokens,
  criterionAnchorTokens,
  requiresTechnicalAnchors,
  resumeMeetsTechnicalAnchors,
} from "./legitimacy-utils.js";

const TOOL_RE =
  /\b(?:primavera|p6|ms\s*project|microsoft\s*project|msp|oracle\s*primavera|scheduling\s*software)\b/i;
const ACTIVITY_RE =
  /\b(?:schedul(?:e|ing|er)|cpm|critical\s*path|baseline|cost\s*engineer(?:ing)?|project\s*controls|earned\s*value|evms?|wbs|planning)\b/i;
const CONTEXT_RE =
  /\b(?:epc|data\s*center|nuclear|industrial|construction|refinery|pipeline|power\s*plant|infrastructure|capital\s*project)\b/i;

export function analyzeLegitimacy(criterionText, snippet, section, signals, jdRaw, domainPack) {
  const jdEchoPercent = computeJdEchoPercent(criterionText, snippet, jdRaw);
  const intent = buildIntentChecklist(criterionText, snippet, signals, domainPack, section);
  const intentMet = intent.filter((i) => i.status === "met").length;
  const intentRequired = intent.filter((i) => i.status !== "na").length;
  const proofMet = intent.filter((i) => i.id.startsWith("proof-") && i.status === "met").length;
  const proofRequired = intent.filter((i) => i.id.startsWith("proof-") && i.status !== "na").length;

  const headerLike = section === "header" || section === "summary" || section === "skills";
  const inExperience = section === "experience";

  let tier = "not-found";
  let label = "Not evidenced";
  let summary = "No resume text supports this requirement.";

  if (!snippet) {
    return { tier, label, summary, jdEchoPercent: 0, intent };
  }

  if (requiresTechnicalAnchors(criterionText) && !resumeMeetsTechnicalAnchors(criterionText, snippet)) {
    const anchors = criterionAnchorTokens(criterionText);
    return {
      tier: "not-on-resume",
      label: "Not stated on resume",
      summary: `Posting requires ${anchors.slice(0, 4).join(", ")}—none appear in the resume text we matched. Scheduler/EPC summary alone does not prove this.`,
      jdEchoPercent: computeResumeEchoPercent(criterionText, snippet),
      intent,
    };
  }

  if (jdEchoPercent >= 55 && headerLike) {
    tier = "likely-mirrored";
    label = "Likely mirrored from JD";
    summary =
      "Resume language closely tracks the posting but sits in a header/summary/skills block—not tied to a specific job.";
  } else if (jdEchoPercent >= 70) {
    tier = "likely-mirrored";
    label = "Likely mirrored from JD";
    summary = "Resume excerpt closely echoes the job requirement wording. Verify with project-specific questions.";
  } else if (headerLike) {
    tier = "self-reported";
    label = "Self-reported claim";
    summary = "Requirement appears as a claim upfront, without experience-level proof (employer, dates, deliverable).";
  } else if (inExperience && proofMet >= 1 && intentMet >= Math.ceil(intentRequired * 0.6)) {
    tier = "supported";
    label = "Supported in experience";
    summary = "Evidence appears under experience with job-level context. Still confirm in a live screen.";
  } else if (inExperience || intentMet >= 2) {
    tier = "partial";
    label = "Partially supported";
    summary = "Some intent is present but proof is incomplete—ask for employer, dates, and deliverables.";
  } else if (intentMet >= 1) {
    tier = "self-reported";
    label = "Self-reported claim";
    summary = "Tool or keyword mentioned without enough project proof.";
  }

  return { tier, label, summary, jdEchoPercent, intent };
}

export function computeJdEchoPercent(criterionText, snippet, jdRaw) {
  return computeResumeEchoPercent(criterionText, snippet, jdRaw);
}

/** How much the resume excerpt actually repeats this requirement (not the JD alone). */
function computeResumeEchoPercent(criterionText, snippet, jdRaw) {
  if (!snippet) return 0;

  const critTokens = significantTokens(criterionText);
  const snipSet = new Set(significantTokens(snippet));
  const tokenOverlap =
    critTokens.length ? critTokens.filter((t) => snipSet.has(t)).length / critTokens.length : 0;

  let phraseHit = 0;
  const phrases = collectEchoPhrases(criterionText, jdRaw);
  for (const phrase of phrases) {
    if (phrase.length < 10) continue;
    if (snippet.toLowerCase().includes(phrase.toLowerCase())) {
      phraseHit = 1;
      break;
    }
    if (fuzzyPhraseInSnippet(snippet, phrase)) phraseHit = Math.max(phraseHit, 0.85);
  }

  return Math.round(Math.min(100, tokenOverlap * 65 + phraseHit * 35));
}

function buildIntentChecklist(criterionText, snippet, signals, domainPack, section = "") {
  const resume = (snippet || "").toLowerCase();
  const critLower = criterionText.toLowerCase();
  const signalSet = new Set(signals || []);

  const needsTool =
    TOOL_RE.test(critLower) ||
    (domainPack?.keywordHints?.must || []).some((k) => critLower.includes(k) && TOOL_RE.test(k));
  const needsActivity = ACTIVITY_RE.test(critLower);
  const needsContext = CONTEXT_RE.test(critLower);

  const toolMet = TOOL_RE.test(resume) || hasToolKeyword(resume, domainPack);
  const activityMet = ACTIVITY_RE.test(resume);
  const contextMet = CONTEXT_RE.test(resume);

  const inExperience = section === "experience";
  const proofItems = [
    { id: "proof-dates", label: "Dates / timeframe", met: signalSet.has("dates") || signalSet.has("tenure") },
    {
      id: "proof-employer",
      label: "Employer / client",
      met: inExperience && signalSet.has("employer"),
    },
    {
      id: "proof-deliverable",
      label: "Deliverable / output",
      met:
        inExperience &&
        (signalSet.has("deliverable") || signalSet.has("metrics")) &&
        !bareScheduleOnlyDeliverable(criterionText, resume),
    },
    { id: "proof-project", label: "Project context", met: signalSet.has("project context") },
  ];

  const checklist = [];

  if (needsTool || toolMet) {
    checklist.push({
      id: "intent-tool",
      label: "Tool / software",
      status: toolMet ? "met" : "missing",
    });
  }

  if (needsActivity || activityMet) {
    checklist.push({
      id: "intent-activity",
      label: "Role / activity",
      status: activityMet ? "met" : "missing",
    });
  }

  if (needsContext || contextMet) {
    checklist.push({
      id: "intent-context",
      label: "Project / industry context",
      status: contextMet ? "met" : needsContext ? (contextMet ? "met" : "missing") : "na",
    });
  }

  for (const p of proofItems) {
    checklist.push({
      id: p.id,
      label: p.label,
      status: snippet ? (p.met ? "met" : "missing") : "na",
    });
  }

  if (/drawing/i.test(critLower)) {
    checklist.push({
      id: "req-drawings",
      label: "Drawings mentioned on resume",
      status: /\bdrawings?\b/i.test(resume) ? "met" : "missing",
    });
  }
  if (/specification/i.test(critLower)) {
    checklist.push({
      id: "req-specs",
      label: "Specifications mentioned on resume",
      status: /specifications?/i.test(resume) ? "met" : "missing",
    });
  }
  if (/statements?\s+of\s+work|\bsow\b/i.test(critLower)) {
    checklist.push({
      id: "req-sow",
      label: "Statement of work mentioned on resume",
      status: /statements?\s+of\s+work|\bsow\b/i.test(resume) ? "met" : "missing",
    });
  }

  return checklist;
}

function bareScheduleOnlyDeliverable(criterionText, resume) {
  if (!/drawing|specification/i.test(criterionText)) return false;
  return /\bschedule\b/i.test(resume) && !/\bdrawings?\b|specifications?/i.test(resume);
}

function hasToolKeyword(text, domainPack) {
  const hints = [...(domainPack?.keywordHints?.must || []), ...(domainPack?.keywordHints?.preferred || [])];
  return hints.some((k) => TOOL_RE.test(k) && text.includes(k.toLowerCase()));
}

function collectEchoPhrases(criterionText, jdRaw) {
  const phrases = new Set();
  phrases.add(criterionText.trim());

  if (jdRaw) {
    const lines = jdRaw
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-•*●▪◦]\s+/, "").trim())
      .filter((l) => l.length > 12 && l.length < 220);
    const critTokens = significantTokens(criterionText);
    for (const line of lines) {
      const lineTokens = significantTokens(line);
      const overlap = lineTokens.filter((t) => critTokens.includes(t)).length;
      if (overlap >= Math.min(3, critTokens.length)) phrases.add(line);
    }
  }

  const words = criterionText.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  for (let i = 0; i < words.length - 2; i++) {
    phrases.add(words.slice(i, i + 4).join(" "));
  }
  return [...phrases];
}

function fuzzyPhraseInSnippet(snippet, phrase) {
  const tokens = significantTokens(phrase);
  if (tokens.length < 3) return false;
  const snip = snippet.toLowerCase();
  const hit = tokens.filter((t) => snip.includes(t)).length;
  return hit / tokens.length >= 0.85;
}

export function legitimacyWeight(tier) {
  return {
    supported: 1,
    partial: 0.55,
    "self-reported": 0.15,
    "likely-mirrored": 0.08,
    "not-on-resume": 0,
    "not-found": 0,
  }[tier] ?? 0;
}
