/** Tooltip copy for scorecard and screen-kit labels. */

export const CONFIDENCE_TIPS = {
  high: {
    title: "High — substantiated",
    definition:
      "Resume text ties this requirement to a specific job: employer, dates, and a deliverable or project context—not just a keyword in a skills list.",
  },
  medium: {
    title: "Medium — partial context",
    definition:
      "Some related language appears under experience, but proof is thin. Confirm employer, dates, schedule size, and what they personally delivered.",
  },
  relevant: {
    title: "Relevant role — verify duty",
    definition:
      "The same employer or role block matches loosely, but this specific duty is not clearly stated. Treat as role fit, not proof they performed this task.",
  },
  low: {
    title: "Low — keyword only",
    definition:
      "Only a summary, skills list, or generic keyword hit—no dated project bullet that substantiates the requirement.",
  },
  none: {
    title: "Not found",
    definition: "No acceptable resume excerpt matched this requirement (header/contact blocks are ignored).",
  },
  "not-stated": {
    title: "Not stated on resume",
    definition:
      "The posting requires specifics (e.g. drawings, specifications, SOW) that do not appear in the resume text we could match.",
  },
};

export const LEGITIMACY_TIPS = {
  "likely-mirrored": {
    title: "Likely mirrored from JD",
    definition:
      "Resume wording closely tracks the job posting—often summary or skills—with little experience-level proof. Common with AI-tailored resumes.",
  },
  "self-reported": {
    title: "Self-reported claim",
    definition:
      "The requirement shows up as an upfront claim (summary/header/skills) without a substantiating experience bullet.",
  },
  supported: {
    title: "Supported in experience",
    definition:
      "Evidence sits under experience with job context and some intent met. Still verify live—resumes can overstate scope.",
  },
  partial: {
    title: "Partially supported",
    definition:
      "Some intent is present but proof is incomplete. Ask for employer, dates, tools used, and a concrete deliverable.",
  },
  "not-on-resume": {
    title: "Not stated on resume",
    definition:
      "Technical or duty-specific terms from the posting are missing from matched resume text.",
  },
  "not-found": {
    title: "Not evidenced",
    definition: "No resume text supports this requirement at the depth we require for screening.",
  },
  unknown: {
    title: "Unclassified",
    definition: "Legitimacy could not be classified—use the verification question in the screen kit.",
  },
};

export const RECOMMENDATION_TIPS = {
  Submit: {
    title: "Submit",
    definition:
      "Enough substantiated must-have evidence and acceptable mirroring risk to advance—still run your live screen.",
  },
  "Verify Further": {
    title: "Verify Further",
    definition:
      "Resume mentions requirements but proof is weak, mirrored, or role-only. Use the screen kit before submitting to the client.",
  },
  "Do Not Submit": {
    title: "Do Not Submit",
    definition:
      "Low coverage, heavy JD mirroring, or deal-breaker signals. Do not present without clearing gaps in a screen.",
  },
};

export const MIRROR_RISK_TIPS = {
  high: {
    title: "Tailoring risk: high",
    definition:
      "Resume language closely overlaps the posting across many requirements—strong signal of copy-paste or AI tailoring.",
  },
  medium: {
    title: "Tailoring risk: medium",
    definition: "Notable overlap with posting language. Probe project specifics that are not on the resume.",
  },
  low: {
    title: "Tailoring risk: low",
    definition: "Limited phrase overlap with the job description relative to experience bullets.",
  },
  none: {
    title: "Tailoring risk: none",
    definition: "Little detected overlap between resume phrasing and the saved job description.",
  },
};

export const MISC_TIPS = {
  "not-on-resume-badge": {
    title: "Not on resume",
    definition: "This requirement wording does not appear on the resume; the screen question targets a live verification.",
  },
  "jd-echo": {
    title: "Resume echoes requirement",
    definition:
      "Percent of meaningful requirement words that also appear in the matched resume excerpt. High echo with low duty overlap often means mirroring, not proof.",
  },
};

export const COVERAGE_COUNT_TIPS = {
  substantiated: {
    title: "Substantiated",
    definition: "Must-haves rated High — substantiated (dated experience with duty-relevant overlap).",
  },
  "role-related": {
    title: "Role-related",
    definition: "Must-haves rated Relevant role — verify duty (shared job block, duty not proven).",
  },
  partial: {
    title: "Partial",
    definition: "Requirements rated Medium — partial context.",
  },
  "keyword-only": {
    title: "Keyword-only",
    definition: "Requirements rated Low — keyword only (summary/skills).",
  },
  "supported-pct": {
    title: "Supported in experience %",
    definition: "Share of criteria whose legitimacy tier is Supported in experience (not the same as High confidence).",
  },
  mirrored: {
    title: "Likely JD-mirrored",
    definition: "Count of criteria flagged as likely mirrored from the job description.",
  },
};

export function confidenceDisplayLabel(confidence) {
  return CONFIDENCE_TIPS[confidence]?.title || confidence || "—";
}

export function resolveConfidenceTipKey(confidence, labelText = "") {
  const label = (labelText || "").toLowerCase();
  if (label.includes("not stated")) return "not-stated";
  if (label.includes("relevant role")) return "relevant";
  if (label.includes("substantiated") || label.includes("high")) return "high";
  if (label.includes("partial context") || label.includes("medium")) return "medium";
  if (label.includes("keyword")) return "low";
  if (label.includes("not found")) return "none";
  return confidence || "none";
}

export function resolveLegitimacyTipKey(tierOrLabel) {
  if (!tierOrLabel) return "unknown";
  const s = String(tierOrLabel).toLowerCase();
  if (s.includes("mirror")) return "likely-mirrored";
  if (s.includes("self-reported")) return "self-reported";
  if (s.includes("supported") && !s.includes("partial")) return "supported";
  if (s.includes("partial")) return "partial";
  if (s.includes("not stated") || s.includes("not-on")) return "not-on-resume";
  if (s.includes("not evidenced") || s.includes("not-found")) return "not-found";
  if (LEGITIMACY_TIPS[s]) return s;
  return "unknown";
}

export function getTipDefinition(tipKey) {
  return (
    CONFIDENCE_TIPS[tipKey]?.definition ||
    LEGITIMACY_TIPS[tipKey]?.definition ||
    RECOMMENDATION_TIPS[tipKey]?.definition ||
    MIRROR_RISK_TIPS[tipKey]?.definition ||
    MISC_TIPS[tipKey]?.definition ||
    COVERAGE_COUNT_TIPS[tipKey]?.definition ||
    "No definition available for this label."
  );
}
