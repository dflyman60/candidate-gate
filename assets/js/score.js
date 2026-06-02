import { summarizeResumeClaims } from "./resume-parse.js";

export function scoreCandidate(resumeText, requisition, domainPack) {
  const mustResults = requisition.mustHaves.map((c) => matchCriterion(resumeText, c.text, domainPack));
  const prefResults = requisition.preferred.map((c) => matchCriterion(resumeText, c.text, domainPack));
  const dealResults = requisition.dealBreakers.map((c) => assessDealBreaker(resumeText, c.text, domainPack));

  const mustMatched = mustResults.filter((r) => r.matched).length;
  const mustTotal = mustResults.length || 1;
  const mustPct = Math.round((mustMatched / mustTotal) * 100);

  const prefMatched = prefResults.filter((r) => r.matched).length;
  const prefTotal = prefResults.length || 1;
  const prefPct = prefResults.length ? Math.round((prefMatched / prefTotal) * 100) : 0;

  const dealRisks = dealResults.filter((r) => r.risk);
  const dealRiskPct = dealResults.length
    ? Math.round((dealRisks.length / dealResults.length) * 100)
    : 0;

  const overall = computeOverall(mustPct, prefPct, dealRisks.length, mustTotal);
  const recommendation = recommend(overall, mustPct, dealRisks.length, mustMatched, mustTotal);

  const gaps = mustResults.filter((r) => !r.matched).map((r) => r.text);
  const screeningQuestion = buildScreeningQuestion(gaps, prefResults, requisition);

  return {
    overall,
    recommendation,
    mustHaveCoverage: { matched: mustMatched, total: mustTotal, percent: mustPct, items: mustResults },
    preferredCoverage: { matched: prefMatched, total: prefTotal, percent: prefPct, items: prefResults },
    dealBreakerRisks: dealRisks,
    dealRiskPercent: dealRiskPct,
    resumeClaimSummary: summarizeResumeClaims(resumeText, requisition, domainPack),
    suggestedScreeningQuestion: screeningQuestion,
    scoredAt: new Date().toISOString(),
  };
}

function computeOverall(mustPct, prefPct, dealRiskCount, mustTotal) {
  const mustWeight = 0.6;
  const prefWeight = 0.25;
  const penaltyPerRisk = mustTotal >= 4 ? 8 : 12;
  const dealPenalty = Math.min(30, dealRiskCount * penaltyPerRisk);
  const raw = mustPct * mustWeight + prefPct * prefWeight + 15;
  return Math.max(0, Math.min(100, Math.round(raw - dealPenalty)));
}

function recommend(overall, mustPct, dealRiskCount, mustMatched, mustTotal) {
  if (dealRiskCount > 0 && mustPct < 50) return "Do Not Submit";
  if (dealRiskCount > 0 || mustPct < 60) return "Verify Further";
  if (overall >= 72 && mustMatched >= Math.ceil(mustTotal * 0.75)) return "Submit";
  if (overall >= 55 && mustPct >= 60) return "Verify Further";
  return "Do Not Submit";
}

function buildScreeningQuestion(mustGaps, prefResults, requisition) {
  if (mustGaps.length) {
    const gap = mustGaps[0];
    return `The resume does not clearly show: "${gap}". Walk me through a specific project where you used this, including tools, duration, and your role.`;
  }
  const prefGap = prefResults.find((r) => !r.matched);
  if (prefGap) {
    return `Preferred skill "${prefGap.text}" is not evident on the resume. Describe your strongest related experience and how recently you used it.`;
  }
  const title = requisition.title || "this role";
  return `For ${title}, describe your most complex schedule or controls deliverable in the last 24 months and how you validated quality before client submission.`;
}

function matchCriterion(resumeText, criterionText, domainPack) {
  const resume = resumeText.toLowerCase();
  const criterion = criterionText.toLowerCase();
  const evidence = [];

  if (resume.includes(criterion)) {
    evidence.push("direct phrase match");
  }

  const aliases = expandAliases(criterion, domainPack);
  for (const alias of aliases) {
    if (alias.length > 2 && resume.includes(alias)) {
      evidence.push(`matched: ${alias}`);
    }
  }

  const critTokens = significantTokens(criterion);
  const resumeTokens = new Set(significantTokens(resume));
  const matchedTokens = critTokens.filter((t) => resumeTokens.has(t));
  const tokenScore = critTokens.length ? matchedTokens.length / critTokens.length : 0;

  if (tokenScore >= 0.55) evidence.push(`keyword overlap (${Math.round(tokenScore * 100)}%)`);

  const matched = evidence.length > 0;
  return { text: criterionText, matched, evidence: [...new Set(evidence)] };
}

function assessDealBreaker(resumeText, breakerText, domainPack) {
  const lower = breakerText.toLowerCase();
  const resume = resumeText.toLowerCase();

  const negPatterns = [
    /no\s+(\w[\w\s]{2,40})/i,
    /without\s+(\w[\w\s]{2,40})/i,
    /lack of\s+(\w[\w\s]{2,40})/i,
  ];

  for (const pat of negPatterns) {
    const m = breakerText.match(pat);
    if (m) {
      const concept = m[1].toLowerCase();
      const aliases = expandAliases(concept, domainPack);
      const hasSkill = aliases.some((a) => resume.includes(a));
      if (!hasSkill) {
        return { text: breakerText, risk: true, reason: `Resume may lack: ${concept}` };
      }
      return { text: breakerText, risk: false, reason: "Related experience found" };
    }
  }

  if (lower.includes("unable") || lower.includes("on-site") || lower.includes("on site")) {
    const onsiteNo = /not\s+(?:willing|able)\s+to\s+(?:relocate|travel|work\s+on-?site)/i.test(resumeText);
    if (onsiteNo) return { text: breakerText, risk: true, reason: "Resume suggests on-site/travel limitation" };
  }

  const breakerTokens = significantTokens(lower);
  const hitCount = breakerTokens.filter((t) => resume.includes(t)).length;
  if (hitCount >= Math.max(2, Math.ceil(breakerTokens.length * 0.5))) {
    return { text: breakerText, risk: true, reason: "Resume contains phrasing related to this deal-breaker" };
  }

  return { text: breakerText, risk: false, reason: "No clear deal-breaker signal" };
}

function expandAliases(text, domainPack) {
  const aliases = new Set(significantTokens(text));
  const map = {
    "primavera p6": ["p6", "primavera", "oracle primavera"],
    "ms project": ["microsoft project", "ms project", "msp"],
    cpm: ["critical path", "cpm"],
    evm: ["earned value", "evms", "earned value management"],
    scheduler: ["scheduling", "schedule development", "project scheduler"],
    "cost engineer": ["cost engineering", "cost control", "cost analyst"],
  };
  const lower = text.toLowerCase();
  for (const [key, vals] of Object.entries(map)) {
    if (lower.includes(key) || vals.some((v) => lower.includes(v))) {
      vals.forEach((v) => aliases.add(v));
      aliases.add(key);
    }
  }
  (domainPack.keywordHints?.must || []).forEach((k) => {
    if (lower.includes(k) || [...aliases].some((a) => k.includes(a))) aliases.add(k.toLowerCase());
  });
  return [...aliases];
}

function significantTokens(text) {
  const stop = new Set([
    "the", "and", "for", "with", "from", "that", "this", "your", "have", "has", "are", "was", "will",
    "able", "experience", "years", "year", "role", "work", "using", "including", "level", "must",
  ]);
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !stop.has(w));
}
