import { summarizeResumeClaims } from "./resume-parse.js";
import {
  assessCriterionEvidence,
  runConsistencyChecks,
  confidenceWeight,
  isBoilerplateCriterion,
  normalizeSnippetKey,
  annotateSnippetGroups,
} from "./evidence.js";
import { analyzeJdMirroring, mirroringPenalty } from "./mirroring.js";
import { legitimacyWeight } from "./legitimacy.js";

export function scoreCandidate(resumeText, requisition, domainPack) {
  const jdRaw = requisition.jdRaw || "";
  const mustResults = assessCriteriaBatch(resumeText, requisition.mustHaves, domainPack, jdRaw);
  const prefResults = assessCriteriaBatch(resumeText, requisition.preferred, domainPack, jdRaw);
  const dealResults = requisition.dealBreakers.map((c) =>
    assessDealBreaker(resumeText, c.text, domainPack, mustResults)
  );

  const mirroring = analyzeJdMirroring(resumeText, requisition);
  let consistencyFlags = runConsistencyChecks(resumeText, mustResults, requisition);
  consistencyFlags = appendMirroredFlags(consistencyFlags, mustResults);

  const mustWeighted = weightedCoverage(mustResults);
  const prefWeighted = weightedCoverage(prefResults);

  const mustHigh = mustResults.filter((r) => r.confidence === "high").length;
  const mustMedium = mustResults.filter((r) => r.confidence === "medium").length;
  const mustLow = mustResults.filter((r) => r.confidence === "low").length;
  const mustTotal = mustResults.length || 1;

  const mustPct = Math.round(mustWeighted * 100);
  const prefPct = Math.round(prefWeighted * 100);

  const dealRisks = [
    ...dealResults.filter((r) => r.risk),
    ...consistencyFlags.filter((f) => f.severity === "high" || f.severity === "medium"),
    ...mirroring.flags.filter((f) => f.severity === "high"),
  ];

  const overall = computeOverall(mustWeighted, prefWeighted, mirroring.riskLevel, dealRisks.length, mustResults);
  const recommendation = recommend({
    overall,
    mustPct,
    mustHigh,
    mustMedium,
    mustLow,
    mustTotal,
    mirroring,
    dealRisks,
    mustResults,
  });

  const screenKit = buildScreenKit(mustResults, prefResults, mirroring);

  return {
    overall,
    recommendation,
    scoringVersion: "2.7",
    mustHaveCoverage: coverageSummary(mustResults, mustWeighted),
    preferredCoverage: coverageSummary(prefResults, prefWeighted),
    dealBreakerRisks: dealResults.filter((r) => r.risk),
    consistencyFlags,
    mirroring,
    resumeClaimSummary: summarizeResumeClaims(resumeText, requisition, domainPack),
    suggestedScreeningQuestion: screenKit.primaryQuestion,
    screenKit,
    scoredAt: new Date().toISOString(),
  };
}

function weightedCoverage(results) {
  if (!results.length) return 0;
  const sum = results.reduce((acc, r) => acc + blendedCriterionWeight(r), 0);
  return sum / results.length;
}

function blendedCriterionWeight(r) {
  const cw = confidenceWeight(r.confidence);
  const lw = legitimacyWeight(r.legitimacy?.tier);
  if (r.legitimacy?.tier === "likely-mirrored") return Math.min(cw, 0.1);
  if (r.legitimacy?.tier === "self-reported") return Math.min(cw, 0.22);
  if (r.legitimacy?.tier === "not-found") return 0;
  if (lw > 0 && cw > 0) return (cw + lw) / 2;
  return cw;
}

function assessCriteriaBatch(resumeText, items, domainPack, jdRaw) {
  const used = new Set();
  const results = (items || []).map((c) => {
    const text = typeof c === "string" ? c : c.text;
    const r = assessCriterionEvidence(resumeText, text, domainPack, jdRaw, used);
    if (r.snippet) used.add(normalizeSnippetKey(r.snippet));
    return r;
  });
  annotateSnippetGroups(results);
  return results;
}

function coverageSummary(results, weighted) {
  const high = results.filter((r) => r.confidence === "high").length;
  const relevant = results.filter((r) => r.confidence === "relevant").length;
  const medium = results.filter((r) => r.confidence === "medium").length;
  const low = results.filter((r) => r.confidence === "low").length;
  const matched = results.filter((r) => r.matched).length;
  const supported = results.filter((r) => r.legitimacy?.tier === "supported").length;
  const mirrored = results.filter((r) => r.legitimacy?.tier === "likely-mirrored").length;
  return {
    matched,
    total: results.length,
    percent: Math.round(weighted * 100),
    substantiatedPercent: results.length ? Math.round((supported / results.length) * 100) : 0,
    high,
    relevant,
    medium,
    low,
    supported,
    mirrored,
    items: results,
  };
}

function computeOverall(mustWeighted, prefWeighted, mirroringRisk, dealRiskCount, mustResults) {
  const mustWeight = 0.65;
  const prefWeight = 0.2;
  const raw = mustWeighted * 100 * mustWeight + prefWeighted * 100 * prefWeight;
  const mirrorPen = mirroringPenalty(mirroringRisk);
  const dealPen = Math.min(25, dealRiskCount * 6);
  const weakOnly = mustResults.every((r) => !r.matched || r.confidence === "low");
  const weakPen = weakOnly && mustResults.some((r) => r.matched) ? 15 : 0;
  return Math.max(0, Math.min(100, Math.round(raw - mirrorPen - dealPen - weakPen)));
}

function recommend(ctx) {
  const {
    overall,
    mustPct,
    mustHigh,
    mustMedium,
    mustTotal,
    mirroring,
    dealRisks,
    mustResults,
  } = ctx;

  const substantiatedRatio = mustTotal ? mustHigh / mustTotal : 0;
  const highMirror = mirroring.riskLevel === "high";
  const mediumMirror = mirroring.riskLevel === "medium";

  const mirroredCount = mustResults.filter((r) => r.legitimacy?.tier === "likely-mirrored").length;
  const supportedCount = mustResults.filter((r) => r.legitimacy?.tier === "supported").length;

  if (highMirror && substantiatedRatio < 0.5) return "Do Not Submit";
  if (mirroredCount >= Math.ceil(mustTotal * 0.5) && supportedCount === 0) return "Do Not Submit";
  if (mustPct < 35 && mustHigh === 0) return "Do Not Submit";
  if (dealRisks.length >= 3 && mustHigh < 2) return "Do Not Submit";

  if (
    supportedCount >= Math.ceil(mustTotal * 0.5) &&
    mustHigh >= Math.ceil(mustTotal * 0.4) &&
    !highMirror &&
    mirroredCount === 0 &&
    overall >= 68
  ) {
    return "Submit";
  }

  if (mustResults.some((r) => r.matched) || mediumMirror || mustMedium > 0) {
    return "Verify Further";
  }

  return "Do Not Submit";
}

function buildScreenKit(mustResults, prefResults, mirroring) {
  const priority = [
    ...mustResults.filter((r) => r.legitimacy?.tier === "likely-mirrored"),
    ...mustResults.filter((r) => r.legitimacy?.tier === "self-reported"),
    ...mustResults.filter((r) => r.confidence === "none"),
    ...mustResults.filter((r) => r.confidence === "low" && r.legitimacy?.tier !== "likely-mirrored"),
    ...mustResults.filter((r) => r.confidence === "relevant"),
    ...mustResults.filter((r) => r.confidence === "medium"),
    ...prefResults.filter((r) => r.legitimacy?.tier === "likely-mirrored" || r.confidence === "none" || r.confidence === "low"),
  ];

  const questions = priority.slice(0, 6).map((r) => ({
    criterion: r.text,
    confidence: r.confidence,
    legitimacy: r.legitimacy?.label,
    question: r.verificationQuestion,
    snippet: r.snippet,
    sectionLabel: r.sectionLabel,
    matchedTokens: r.matchedTokens,
    phraseOnResume: r.phraseOnResume,
    text: r.text,
    notOnResume: !r.snippet || (isBoilerplateCriterion(r.text) && !r.phraseOnResume),
  }));

  let primaryQuestion = questions[0]?.question;
  if (mirroring.riskLevel === "high" || mirroring.riskLevel === "medium") {
    primaryQuestion =
      "This resume closely tracks the job posting language. Pick one project from the last 3 years and walk me through scope, your employer, dates, schedule size, software used, and one deliverable you personally produced—without reading from the resume.";
  } else if (!primaryQuestion) {
    primaryQuestion =
      "Describe your most complex schedule or controls assignment in the last 24 months: client, contract type, tools, team size, and how quality was checked before submission.";
  }

  return { primaryQuestion, questions };
}

function assessDealBreaker(resumeText, breakerText, domainPack, mustResults) {
  const lower = breakerText.toLowerCase();
  const resume = resumeText.toLowerCase();

  if (/no\s+.+(?:experience|software|scheduling)/i.test(breakerText)) {
    const weakMust = mustResults.filter(
      (r) => r.confidence === "none" || r.confidence === "low" || r.confidence === "relevant"
    ).length;
    if (weakMust >= Math.max(2, Math.floor(mustResults.length * 0.5))) {
      return { text: breakerText, risk: true, reason: "Multiple must-haves lack substantiated evidence" };
    }
  }

  if (lower.includes("unable") || lower.includes("on-site") || lower.includes("on site")) {
    if (/not\s+(?:willing|able)\s+to\s+(?:relocate|travel|work\s+on-?site)/i.test(resumeText)) {
      return { text: breakerText, risk: true, reason: "Resume suggests on-site/travel limitation" };
    }
  }

  if (lower.includes("verifiable") || lower.includes("role history")) {
    const high = mustResults.filter((r) => r.confidence === "high").length;
    if (mustResults.length >= 2 && high === 0) {
      return { text: breakerText, risk: true, reason: "No dated, project-level evidence for core requirements" };
    }
  }

  return { text: breakerText, risk: false, reason: "No clear deal-breaker signal" };
}

function appendMirroredFlags(flags, mustResults) {
  const next = [...flags];
  const mirrored = mustResults.filter((r) => r.legitimacy?.tier === "likely-mirrored");
  if (mirrored.length >= 2) {
    next.push({
      severity: "high",
      title: "Multiple must-haves likely mirrored from JD",
      detail: `${mirrored.length} requirement(s) echo posting language without experience-level proof. Strong signal of AI-tailored or copy-pasted resume.`,
    });
  }
  const selfReported = mustResults.filter((r) => r.legitimacy?.tier === "self-reported");
  if (selfReported.length >= Math.ceil(mustResults.length * 0.6) && mustResults.length >= 3) {
    next.push({
      severity: "medium",
      title: "Most must-haves are self-reported claims",
      detail: "Requirements appear as upfront claims rather than substantiated job bullets.",
    });
  }
  return next;
}
