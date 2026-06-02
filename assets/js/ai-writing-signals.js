/**
 * Heuristic signals for AI-assisted or AI-generated resumes.
 * Rule-based (no LLM)—aligned with recruiter/Google-style tells: wall-of-text summary,
 * template bullets, skills-keyword stuffing, duplicates, and skills-without-experience gaps.
 */

import { activeCriteria } from "./criteria.js";

const AI_BUZZ_PHRASES = [
  "results-driven",
  "detail-oriented",
  "self-starter",
  "team player",
  "proven track record",
  "dynamic professional",
  "strategic thinker",
  "innovative problem-solver",
  "passionate about",
  "leveraged",
  "spearheaded",
  "orchestrated",
  "streamlined",
  "synergies",
  "cross-functional",
  "stakeholder",
  "deliverables",
  "thought leader",
  "best practices",
  "value-added",
  "proactive",
  "highly motivated",
  "seeking to leverage",
  "excellence",
  "visionary",
  "integrated master schedule",
  "dcma",
];

const AI_POWER_VERBS = [
  "spearheaded",
  "orchestrated",
  "leveraged",
  "streamlined",
  "optimized",
  "optimised",
  "facilitated",
  "championed",
  "drove",
  "delivered",
  "implemented",
  "executed",
  "managed",
  "developed",
  "coordinated",
];

const VAGUE_PHRASES = [
  "significant",
  "substantial",
  "various",
  "multiple",
  "several",
  "numerous",
  "extensive",
  "comprehensive",
  "robust",
  "strong background",
  "proven success",
  "key initiatives",
  "wide range",
];

const ROUND_METRIC_RE = /\b(\d{1,3})\s*%|\b(\d{1,3})\s*percent\b/gi;
const SPECIFIC_METRIC_RE = /\b\d{1,3}\.\d+\s*%|\$\d[\d,]*(?:\.\d+)?[kmb]?|\b\d{4,}\b/gi;

const SIGNAL_WEIGHT = { flag: 14, warn: 7 };

export function analyzeAiWritingSignals(resumeText, requisition = {}) {
  const text = resumeText || "";
  const lower = text.toLowerCase();
  let sections = splitResumeSections(text);
  const mashed = splitByMashedMarkers(text);
  if ((mashed.experience || "").length > (sections.experience || "").length) {
    sections = { ...sections, ...mashed };
  }
  if ((mashed.skills || "").length > (sections.skills || "").length) {
    sections.skills = mashed.skills;
  }
  if ((mashed.summary || "").length > (sections.summary || "").length) {
    sections.summary = mashed.summary;
  }

  const bullets = extractExperienceBullets(text, sections.experience);
  const words = lower.split(/\W+/).filter(Boolean);
  const wordCount = Math.max(words.length, 1);

  const signals = [];
  const flags = [];

  const buzzHits = countPhraseHits(lower, AI_BUZZ_PHRASES);
  const buzzPer100 = (buzzHits / wordCount) * 100;
  pushSignal(signals, {
    id: "buzzwords",
    label: "AI-style buzzwords",
    status: buzzHits >= 6 ? "flag" : buzzHits >= 3 ? "warn" : "ok",
    weight: buzzHits >= 6 ? 12 : 6,
    detail:
      buzzHits >= 6
        ? `${buzzHits} cliché / ATS-stuffing phrases (leveraged, results-driven, integrated master schedule, etc.).`
        : buzzHits >= 3
          ? `${buzzHits} generic corporate phrases detected.`
          : "Few generic buzz phrases.",
    value: buzzHits,
  });

  const wallSummary = scoreWallOfTextSummary(sections.summary);
  pushSignal(signals, {
    id: "wall-summary",
    label: "Dense keyword summary (wall of text)",
    status: wallSummary.flag ? "flag" : wallSummary.warn ? "warn" : "ok",
    weight: wallSummary.flag ? 18 : 8,
    detail: wallSummary.summary,
    value: wallSummary.chars,
  });

  const uniformBullets = scoreBulletUniformity(bullets);
  pushSignal(signals, {
    id: "bullet-uniformity",
    label: "Template bullet rhythm",
    status: uniformBullets.score >= 0.68 ? "flag" : uniformBullets.score >= 0.5 ? "warn" : "ok",
    weight: uniformBullets.score >= 0.68 ? 16 : 8,
    detail: uniformBullets.summary,
    value: Math.round(uniformBullets.score * 100),
  });

  const repetitive = scoreRepetitiveOpenings(bullets);
  pushSignal(signals, {
    id: "repetitive-openings",
    label: "Repetitive bullet openings",
    status: repetitive.ratio >= 0.45 ? "flag" : repetitive.ratio >= 0.32 ? "warn" : "ok",
    weight: repetitive.ratio >= 0.45 ? 10 : 5,
    detail: repetitive.summary,
    value: Math.round(repetitive.ratio * 100),
  });

  const dupSkills = scoreDuplicateSkills(sections.skills);
  pushSignal(signals, {
    id: "duplicate-skills",
    label: "Duplicate skills entries",
    status: dupSkills.flag ? "flag" : "ok",
    weight: dupSkills.flag ? 14 : 0,
    detail: dupSkills.summary,
    value: dupSkills.count,
  });

  const capsChaos = scoreSkillsCapitalizationChaos(sections.skills);
  pushSignal(signals, {
    id: "skills-caps",
    label: "Inconsistent skills capitalization",
    status: capsChaos.flag ? "flag" : capsChaos.warn ? "warn" : "ok",
    weight: capsChaos.flag ? 12 : 5,
    detail: capsChaos.summary,
    value: capsChaos.hits,
  });

  const skillsGap = scoreSkillsWithoutExperience(text, sections, requisition);
  pushSignal(signals, {
    id: "skills-jd-gap",
    label: "JD keywords in skills, not in experience",
    status: skillsGap.flag ? "flag" : skillsGap.warn ? "warn" : "ok",
    weight: skillsGap.flag ? 20 : 8,
    detail: skillsGap.summary,
    value: skillsGap.gapCount,
  });

  const roundMetrics = scoreRoundMetrics(text);
  pushSignal(signals, {
    id: "round-metrics",
    label: "Round-number metrics",
    status: roundMetrics.flag ? "warn" : "ok",
    weight: roundMetrics.flag ? 6 : 0,
    detail: roundMetrics.summary,
    value: roundMetrics.roundCount,
  });

  const vague = countPhraseHits(lower, VAGUE_PHRASES);
  const hasSpecifics = SPECIFIC_METRIC_RE.test(text) || /\b(?:19|20)\d{2}\b/.test(text);
  pushSignal(signals, {
    id: "vague-claims",
    label: "Vague claims vs specifics",
    status: vague >= 5 && !hasSpecifics ? "flag" : vague >= 3 ? "warn" : "ok",
    weight: vague >= 5 ? 8 : 4,
    detail:
      vague >= 5 && !hasSpecifics
        ? `${vague} vague qualifiers with little dated or numeric detail.`
        : vague >= 3
          ? `Some vague wording (${vague} hits).`
          : "Reasonable mix of concrete detail.",
    value: vague,
  });

  const punctuation = scoreAiPunctuation(text);
  pushSignal(signals, {
    id: "punctuation",
    label: "Formal punctuation pattern",
    status: punctuation.flag ? "warn" : "ok",
    weight: punctuation.flag ? 5 : 0,
    detail: punctuation.summary,
    value: punctuation.emDashes,
  });

  const specificity = scoreSpecificityAnchors(text);
  pushSignal(signals, {
    id: "specificity",
    label: "Specific anchors (dates, employers, tools)",
    status: specificity.score < 0.3 ? "flag" : specificity.score < 0.45 ? "warn" : "ok",
    weight: specificity.score < 0.3 ? 10 : 4,
    detail: specificity.summary,
    value: Math.round(specificity.score * 100),
  });

  const summaryMirror = scoreSummaryJdMirror(sections.summary || text, requisition.jdRaw || "");
  pushSignal(signals, {
    id: "summary-mirror",
    label: "Summary mirrors posting language",
    status: summaryMirror.ratio >= 0.42 ? "flag" : summaryMirror.ratio >= 0.3 ? "warn" : "ok",
    weight: summaryMirror.ratio >= 0.42 ? 12 : 6,
    detail: summaryMirror.summary,
    value: Math.round(summaryMirror.ratio * 100),
  });

  const flagCount = signals.filter((s) => s.status === "flag").length;
  const warnCount = signals.filter((s) => s.status === "warn").length;

  let aiLikelihood = signals.reduce((sum, s) => {
    if (s.status === "flag") return sum + (s.weight || SIGNAL_WEIGHT.flag);
    if (s.status === "warn") return sum + (s.weight || SIGNAL_WEIGHT.warn);
    return sum;
  }, 0);
  aiLikelihood = Math.min(100, Math.round(aiLikelihood + buzzPer100 * 0.5));
  const humanLikelihood = Math.max(0, 100 - aiLikelihood);

  if (flagCount >= 3 || aiLikelihood >= 60) {
    flags.push({
      severity: "high",
      title: "Strong AI-tailoring patterns",
      detail:
        "Dense summary, template bullets, skills-keyword gaps, and/or ATS-style duplication—similar to what LLM reviewers flag. Use targeted screen questions (skills listed but not in job bullets).",
    });
  } else if (flagCount >= 2 || aiLikelihood >= 45 || warnCount >= 4) {
    flags.push({
      severity: "medium",
      title: "Notable AI-style writing signals",
      detail:
        "Several structural or keyword-stuffing cues warrant verification—not auto-reject.",
    });
  } else if (flagCount >= 1 || warnCount >= 2) {
    flags.push({
      severity: "low",
      title: "Minor polish / template cues",
      detail: "Some formal or generic phrasing—confirm depth in a live screen.",
    });
  }

  const riskLevel =
    aiLikelihood >= 65 || flagCount >= 3
      ? "high"
      : aiLikelihood >= 40 || flagCount >= 2 || warnCount >= 4
        ? "medium"
        : aiLikelihood >= 22 || warnCount >= 2
          ? "low"
          : "none";

  return {
    riskLevel,
    aiLikelihood,
    humanLikelihood,
    signals,
    flags,
    summary: buildSummary(riskLevel, aiLikelihood, flagCount, warnCount),
    methodNote:
      "Rule-based pattern scan (not Gemini/ChatGPT). May differ from Google AI review scores—we flag structure and skills/experience gaps, not semantic paraphrase alone.",
  };
}

function pushSignal(list, signal) {
  list.push(signal);
}

function buildSummary(riskLevel, aiLikelihood, flagCount, warnCount) {
  if (riskLevel === "high") {
    return `Elevated AI-assist likelihood (${aiLikelihood}%) — ${flagCount} strong pattern(s), ${warnCount} moderate. Compare with a live screen; LLM reviewers often score higher on the same resume.`;
  }
  if (riskLevel === "medium") {
    return `Notable AI-style cues (${aiLikelihood}%) — template structure, skills stuffing, or JD echo. Verify TIA/tools in experience bullets.`;
  }
  if (riskLevel === "low") {
    return `Light template signals (${aiLikelihood}%)—some polish possible; still screen key claims.`;
  }
  return "Few structural AI cues—resume reads relatively specific and varied.";
}

const SECTION_MARKERS =
  /\b(?:summary|profile|objective|skills|competencies|technical\s*skills|experience|employment|work\s*history|education|certifications?)\b/gi;

function isLineStartSectionHeader(text, index, label) {
  if (index === 0) return true;
  const before = text[index - 1];
  if (before !== "\n" && before !== "\r" && before !== " " && before !== "\t") return false;

  const after = text.slice(index, index + label.length + 32);
  const header =
    /^(?:summary|profile|objective|skills|competencies|technical\s*skills|experience|employment|work\s*history|education|certifications?)\s*(?:\n|:|\s+[A-Z0-9]|\s*$)/i;

  if (!header.test(after)) return false;

  // Reject "construction experience" mid-sentence (not a section title).
  if (/experience/i.test(label) && /[a-z]\s+experience/i.test(text.slice(Math.max(0, index - 12), index + 12))) {
    return false;
  }

  return true;
}

function stripSectionHeader(chunk, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return chunk.replace(new RegExp(`^\\s*${escaped}\\s*:?\\s*`, "i"), "").trim();
}

function normalizeSectionLabel(label) {
  const l = label.toLowerCase().trim();
  if (l.startsWith("technical")) return "technical skills";
  return l;
}

function splitResumeSections(text) {
  const hits = [];
  let m;
  SECTION_MARKERS.lastIndex = 0;
  while ((m = SECTION_MARKERS.exec(text)) !== null) {
    if (!isLineStartSectionHeader(text, m.index, m[0])) continue;
    hits.push({ label: normalizeSectionLabel(m[0]), index: m.index });
  }
  hits.sort((a, b) => a.index - b.index);

  const slice = (labels) => {
    const labelSet = new Set(labels);
    const start = hits.find((h) => labelSet.has(h.label));
    if (!start) return "";
    const startIdx = hits.indexOf(start);
    const end = hits[startIdx + 1];
    const chunk = text.slice(start.index, end ? end.index : text.length);
    return stripSectionHeader(chunk, start.label);
  };

  const sections = {
    summary: slice(["summary", "profile", "objective"]) || extractSummaryBlock(text),
    skills: slice(["skills", "competencies", "technical skills"]),
    experience: slice(["experience", "employment", "work history"]),
    education: slice(["education"]),
  };

  if (hits.length < 2 || (!sections.skills && !sections.experience)) {
    return { ...sections, ...splitByMashedMarkers(text) };
  }

  return sections;
}

/** PDF text often lacks line breaks; fall back to inline section keywords. */
function splitByMashedMarkers(text) {
  const lower = text.toLowerCase();
  const find = (word) => {
    const re = new RegExp(`\\b${word}\\b`, "i");
    const m = re.exec(lower);
    return m ? m.index : -1;
  };

  const summaryIdx = find("summary");
  const skillsIdx = find("skills");
  let expIdx = -1;
  if (skillsIdx >= 0) {
    expIdx = lower.indexOf("experience", skillsIdx + 5);
  }
  if (expIdx < 0 || (summaryIdx >= 0 && expIdx < skillsIdx)) {
    const re = /\bexperience\b/gi;
    let m;
    while ((m = re.exec(lower)) !== null) {
      if (skillsIdx >= 0 && m.index <= skillsIdx) continue;
      if (isLineStartSectionHeader(text, m.index, m[0])) {
        expIdx = m.index;
        break;
      }
    }
  }
  const eduIdx = find("education");

  const cut = (start, end) => (start < 0 ? "" : text.slice(start, end < 0 ? text.length : end).trim());

  let summary = "";
  let skills = "";
  let experience = "";

  if (summaryIdx >= 0 && skillsIdx > summaryIdx) summary = cut(summaryIdx, skillsIdx);
  else if (summaryIdx >= 0 && expIdx > summaryIdx) summary = cut(summaryIdx, expIdx);
  else summary = extractSummaryBlock(text);

  if (skillsIdx >= 0 && expIdx > skillsIdx) skills = cut(skillsIdx + 6, expIdx);
  else if (skillsIdx >= 0) skills = cut(skillsIdx + 6, eduIdx);

  if (expIdx >= 0) experience = cut(expIdx + 10, eduIdx);

  return { summary, skills, experience, education: eduIdx >= 0 ? cut(eduIdx, -1) : "" };
}

function extractExperienceBullets(text, experienceBlock) {
  const source = experienceBlock || text;
  const bullets = [];
  const lines = source.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (/^[-•*●▪◦]\s+/.test(line)) {
      bullets.push(line.replace(/^[-•*●▪◦]\s+/, "").trim());
    }
  }

  const verbLead =
    /^(?:managed|coordinated|developed|delivered|supported|led|spearheaded|implemented|executed|facilitated|oversaw|prepared|analyzed|communicated|worked)\b/i;

  const chunks = source.split(/(?<=[.!?])\s+/);
  for (const c of chunks) {
    const t = c.trim();
    if (t.length < 40 || t.length > 360) continue;
    if (/^(?:turner|lintech|experience|employment|\d{4})/i.test(t)) continue;
    if (verbLead.test(t) || (t.length >= 55 && /^[A-Z]/.test(t))) bullets.push(t);
  }

  const unique = [];
  const seen = new Set();
  for (const b of bullets) {
    const key = b.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(b);
  }

  return unique.slice(0, 50);
}

function scoreWallOfTextSummary(summary) {
  if (!summary || summary.length < 120) {
    return { flag: false, warn: false, chars: 0, summary: "No large summary block detected." };
  }

  const lines = summary.split(/\r?\n/).filter((l) => l.trim().length > 20);
  const longestLine = Math.max(...summary.split(/\r?\n/).map((l) => l.length), summary.length);
  const newlineCount = (summary.match(/\n/g) || []).length;
  const kwHits = (
    summary.match(
      /\b(?:schedul|primavera|p6|baseline|stakeholder|deliverable|construction|project|earned\s*value|dcma|integrated|cross-functional|commercial|data\s*center)\b/gi
    ) || []
  ).length;

  const dense =
    summary.length >= 240 &&
    kwHits >= 5 &&
    (lines.length <= 2 || longestLine >= Math.min(summary.length, 280)) &&
    newlineCount <= 2;

  const warn =
    !dense && summary.length >= 200 && kwHits >= 4 && longestLine >= 180 && newlineCount <= 1;

  return {
    flag: dense,
    warn: !dense && warn,
    chars: summary.length,
    summary: dense
      ? `Summary is a ${summary.length}-character dense keyword block—typical "write a summary from this JD" AI output.`
      : warn
        ? "Summary is long and mostly one paragraph."
        : "Summary length and layout look normal.",
  };
}

function scoreBulletUniformity(bullets) {
  if (bullets.length < 5) {
    return { score: 0, summary: "Not enough experience bullets to assess template rhythm." };
  }

  const charLens = bullets.map((b) => b.length);
  const wordLens = bullets.map((b) => b.split(/\s+/).filter(Boolean).length);
  const avgChar = charLens.reduce((a, b) => a + b, 0) / charLens.length;
  const charDev =
    charLens.reduce((s, l) => s + Math.abs(l - avgChar), 0) / charLens.length / Math.max(avgChar, 1);

  let powerStart = 0;
  let hasMetric = 0;
  for (const b of bullets) {
    const words = b.split(/\s+/).filter(Boolean);
    const first = (words[0] || "").toLowerCase();
    if (AI_POWER_VERBS.includes(first) || /^[a-z]+ed$/.test(first)) powerStart++;
    if (/\d/.test(b)) hasMetric++;
  }

  const powerRatio = powerStart / bullets.length;
  const metricRatio = hasMetric / bullets.length;
  const tightChar = charDev < 0.14;
  const tightWord =
    wordLens.reduce((s, l) => s + Math.abs(l - wordLens[0]), 0) / wordLens.length / Math.max(wordLens[0], 1) <
    0.2;

  const score =
    (tightChar ? 0.4 : 0) +
    (tightWord ? 0.2 : 0) +
    powerRatio * 0.25 +
    (metricRatio >= 0.6 && tightChar ? 0.15 : 0);

  const summary =
    score >= 0.68
      ? `${Math.round(powerRatio * 100)}% power-verb leads and bullets are very similar length (~${Math.round(avgChar)} chars)—classic two-line AI template.`
      : score >= 0.5
        ? `Bullets are fairly uniform (${Math.round(powerRatio * 100)}% same-style openings).`
        : "Bullet length and openings vary naturally.";

  return { score, summary };
}

function scoreDuplicateSkills(skillsBlock) {
  if (!skillsBlock || skillsBlock.length < 20) {
    return { flag: false, count: 0, summary: "No skills section to check for duplicates." };
  }

  const parts = skillsBlock
    .split(/[,;|•\n]/)
    .map((p) => p.trim().toLowerCase().replace(/\s+/g, " "))
    .filter((p) => p.length > 4);

  const seen = new Map();
  const dups = [];
  for (const p of parts) {
    const n = (seen.get(p) || 0) + 1;
    seen.set(p, n);
    if (n === 2) dups.push(p);
  }

  const lineDups = (skillsBlock.match(/(\b[\w\s&/]{8,50}\b)(?:\s*,\s*\1)+/gi) || []).length;

  const count = dups.length + lineDups;
  return {
    flag: count >= 1,
    count,
    summary:
      count >= 1
        ? `Duplicate skill entries (e.g. "${dups[0] || "repeated term"}")—common when AI maximizes ATS keyword density.`
        : "No duplicate skills lines detected.",
  };
}

function scoreSkillsCapitalizationChaos(skillsBlock) {
  if (!skillsBlock || skillsBlock.length < 30) {
    return { flag: false, warn: false, hits: 0, summary: "No skills section for capitalization check." };
  }

  const parts = skillsBlock.split(/[,;|•\n]/).map((p) => p.trim()).filter((p) => p.length > 6);
  let hits = 0;
  for (const p of parts) {
    const words = p.split(/\s+/);
    const hasLower = words.some((w) => /^[a-z]/.test(w) && w.length > 3);
    const hasTitle = words.some((w) => /^[A-Z][a-z]/.test(w));
    const hasAllCaps = words.some((w) => /^[A-Z]{2,}$/.test(w));
    const hasMidLower = /[A-Z][a-z]+\s+[a-z]/.test(p) || /\b[a-z]+\s+[A-Z]/.test(p);
    const hasOddCaps = /[a-z]{2,}[A-Z]|[A-Z]{2,}[a-z]/.test(p);
    if ((hasLower && hasTitle) || hasMidLower || hasOddCaps || (hasAllCaps && hasLower)) hits++;
  }

  return {
    flag: hits >= 3,
    warn: hits >= 1 && hits < 3,
    hits,
    summary:
      hits >= 3
        ? `${hits} skills entries mix random upper/lowercase—fragment-merge pattern from AI prompts.`
        : hits >= 1
          ? "Some inconsistent capitalization in skills list."
          : "Skills capitalization looks consistent.",
  };
}

function scoreSkillsWithoutExperience(text, sections, requisition) {
  const skills = (sections.skills || "").toLowerCase();
  const experience = (sections.experience || "").toLowerCase();
  if (!skills || skills.length < 15) {
    return { flag: false, warn: false, gapCount: 0, summary: "No skills block to compare to experience." };
  }
  if (!experience || experience.length < 30) {
    return {
      flag: false,
      warn: true,
      gapCount: 0,
      summary: "Could not isolate an experience section from PDF text—skills-vs-jobs check skipped.",
    };
  }

  const jdTerms = collectJdScreeningTerms(requisition);
  const skillPhrases = skills
    .split(/[,;|•\n]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 8);

  const gaps = [];
  for (const term of jdTerms) {
    const t = term.toLowerCase();
    if (t.length < 6) continue;
    const inSkills = skills.includes(t) || skillPhrases.some((p) => p.includes(t));
    const inExp = experience.includes(t);
    if (inSkills && !inExp) gaps.push(term);
  }

  const tiaInSkills = /\btime\s*impact\s*analysis\b|\btia\b/.test(skills);
  const tiaInExp = /\btime\s*impact\s*analysis\b|\btia\b/.test(experience);
  if (tiaInSkills && !tiaInExp) gaps.push("time impact analysis (TIA)");

  for (const phrase of skillPhrases) {
    if (phrase.length < 12) continue;
    const inExp = experience.includes(phrase) || fuzzyInText(experience, phrase);
    const looksJd = jdTerms.some((t) => phrase.includes(t) || t.includes(phrase.slice(0, 12)));
    if (looksJd && !inExp && !gaps.some((g) => g.includes(phrase.slice(0, 15)))) {
      gaps.push(phrase.slice(0, 60));
    }
  }

  const gapCount = [...new Set(gaps)].length;
  const mustWantsTia = activeCriteria(requisition.mustHaves || []).some((m) =>
    /tia|time\s*impact\s*analysis/i.test(m.text || "")
  );
  const tiaGap = tiaInSkills && !tiaInExp;
  const flag = gapCount >= 2 || (tiaGap && mustWantsTia) || (tiaGap && gapCount >= 1);
  const warn = !flag && (gapCount === 1 || tiaGap);

  return {
    flag,
    warn,
    gapCount,
    summary:
      flag && tiaGap
        ? `"Time impact analysis" (or TIA) appears in skills but not in any experience bullet—classic AI JD keyword injection. Ask the targeted TIA screen question.`
        : gapCount >= 2
          ? `${gapCount} posting terms appear in skills but not experience bullets (e.g. ${gaps.slice(0, 2).join("; ")})—AI keyword stuffing risk.`
          : warn
            ? `"${gaps[0] || "A posting term"}" is in skills but not substantiated under experience—verify in screen.`
            : "Skills align with experience bullets for key posting terms.",
    gaps: gaps.slice(0, 6),
  };
}

function collectJdScreeningTerms(requisition) {
  const terms = new Set();
  const jd = requisition.jdRaw || "";
  const add = (s) => {
    const t = s.toLowerCase().trim();
    if (t.length > 5) terms.add(t);
  };

  for (const item of activeCriteria(requisition.mustHaves || [])) {
    add(item.text);
    item.text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 5)
      .forEach((w) => terms.add(w));
  }

  const jdPhrases = [
    "time impact analysis",
    "tia",
    "primavera",
    "p6",
    "earned value",
    "dcma",
    "commercial construction",
    "data center",
  ];
  const jdLower = jd.toLowerCase();
  for (const p of jdPhrases) {
    if (jdLower.includes(p)) terms.add(p);
  }

  jd.split(/\W+/)
    .filter((w) => w.length > 6)
    .slice(0, 40)
    .forEach((w) => terms.add(w.toLowerCase()));

  return [...terms];
}

function fuzzyInText(haystack, phrase) {
  const tokens = phrase.split(/\W+/).filter((w) => w.length > 3);
  if (tokens.length < 2) return haystack.includes(phrase);
  const hit = tokens.filter((t) => haystack.includes(t)).length;
  return hit / tokens.length >= 0.85;
}

function extractBullets(text) {
  return extractExperienceBullets(text, "");
}

function countPhraseHits(lower, phrases) {
  let n = 0;
  for (const p of phrases) {
    if (lower.includes(p)) n++;
  }
  return n;
}

function scoreRepetitiveOpenings(bullets) {
  if (bullets.length < 4) return { ratio: 0, summary: "Not enough bullets to compare openings." };

  const openings = new Map();
  for (const b of bullets) {
    const open = b
      .toLowerCase()
      .split(/\s+/)
      .slice(0, 2)
      .join(" ");
    openings.set(open, (openings.get(open) || 0) + 1);
  }

  const maxRepeat = Math.max(...openings.values());
  const ratio = maxRepeat / bullets.length;
  return {
    ratio,
    summary:
      ratio >= 0.45
        ? `Same two-word openings repeat across ${Math.round(ratio * 100)}% of bullets.`
        : ratio >= 0.32
          ? "Some repeated bullet openings."
          : "Bullet openings are varied.",
  };
}

function scoreRoundMetrics(text) {
  const rounds = [];
  let m;
  ROUND_METRIC_RE.lastIndex = 0;
  while ((m = ROUND_METRIC_RE.exec(text)) !== null) {
    const n = parseInt(m[1] || m[2], 10);
    if (n % 10 === 0 || n === 25 || n === 50 || n === 75) rounds.push(n);
  }
  const specific = (text.match(SPECIFIC_METRIC_RE) || []).length;
  const roundCount = rounds.length;
  const flag = roundCount >= 3 && specific < 2;
  return {
    roundCount,
    flag,
    summary:
      flag
        ? `${roundCount} round percentages with few precise figures.`
        : roundCount >= 2
          ? `${roundCount} round metric(s)—confirm in screen.`
          : "Metrics look specific or sparse.",
  };
}

function scoreAiPunctuation(text) {
  const emDashes = (text.match(/—/g) || []).length;
  const semicolons = (text.match(/;/g) || []).length;
  const words = text.split(/\W+/).filter(Boolean).length || 1;
  const emPer500 = (emDashes / words) * 500;
  const flag = emDashes >= 4 || (emPer500 >= 2.5 && semicolons >= 3);
  return {
    emDashes,
    flag,
    summary: flag
      ? `${emDashes} em dash(es)—common AI writing fingerprint.`
      : emDashes >= 2
        ? "Some em dashes."
        : "Punctuation looks typical.",
  };
}

function scoreSpecificityAnchors(text) {
  const lower = text.toLowerCase();
  const checks = [
    /\b(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}|(?:19|20)\d{2}\b/.test(text),
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\b/i.test(text),
    /\b(?:turner|linetch|construction|energy|resources|inc|llc|corp)\b/i.test(text),
    /\b(?:primavera|p6|ms\s*project|sap|oracle|autodesk|procore|aws)\b/i.test(lower),
    (text.match(/\$[\d,]+/g) || []).length >= 1,
    (text.match(/\b\d{1,3}\.\d+\s*%/g) || []).length >= 1,
    (text.match(/\b\d{1,2}\+?\s*(?:years?|yrs?)\b/gi) || []).length >= 1,
  ];
  const score = checks.filter(Boolean).length / checks.length;

  return {
    score,
    summary:
      score < 0.3
        ? "Few employers, dates, tools, or precise figures."
        : score < 0.45
          ? "Some anchors present; still probe scope."
          : "Good mix of dates, employers, tools, or metrics.",
  };
}

function scoreSummaryJdMirror(summary, jdRaw) {
  if (!jdRaw || jdRaw.length < 80) {
    return { ratio: 0, summary: "No JD on file to compare summary wording." };
  }
  if (!summary || summary.length < 40) {
    return { ratio: 0, summary: "No clear summary block." };
  }

  const jdTokens = new Set(jdRaw.toLowerCase().split(/\W+/).filter((w) => w.length > 4));
  const sumTokens = summary.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
  if (!sumTokens.length) return { ratio: 0, summary: "Summary too short." };

  const hit = sumTokens.filter((t) => jdTokens.has(t)).length;
  const ratio = hit / sumTokens.length;
  return {
    ratio,
    summary:
      ratio >= 0.42
        ? `${Math.round(ratio * 100)}% of summary terms overlap the posting—JD-tailored summary.`
        : ratio >= 0.3
          ? "Summary partially echoes posting language."
          : "Summary does not heavily mirror the JD.",
  };
}

function extractSummaryBlock(text) {
  const lower = text.toLowerCase();
  const idx = Math.max(lower.indexOf("summary"), lower.indexOf("profile"), lower.indexOf("objective"));
  if (idx < 0) return text.slice(0, Math.min(600, text.length));
  const chunk = text.slice(idx, idx + 900);
  const end = chunk.search(
    /(?:^|\n)\s*(?:experience|skills|employment|work\s*history|education)\s*:?\s*(?:\n|[A-Z])/im
  );
  return end > 40 ? chunk.slice(0, end) : chunk;
}

export function aiWritingPenalty(riskLevel) {
  return { high: 12, medium: 6, low: 2, none: 0 }[riskLevel] ?? 0;
}
