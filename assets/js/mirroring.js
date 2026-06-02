/** Detect resume language that mirrors the job description (AI-tailoring signal). */

export function analyzeJdMirroring(resumeText, requisition) {
  const jd = requisition.jdRaw || "";
  const flags = [];
  if (!jd || jd.length < 80) {
    return {
      riskLevel: "unknown",
      similarityPercent: 0,
      matchedPhrases: [],
      matchedPhraseCount: 0,
      totalPhraseOccurrences: 0,
      flags: [{ severity: "low", title: "No JD on file", detail: "Save the full job description with this requisition for mirroring analysis." }],
    };
  }

  const jdPhrases = collectPhrases(jd, requisition);
  const resumeLower = resumeText.toLowerCase();
  const allMatched = [];

  for (const phrase of jdPhrases) {
    if (phrase.length < 12) continue;
    const pLower = phrase.toLowerCase();
    let nearMatch = false;
    if (resumeLower.includes(pLower)) {
      nearMatch = false;
    } else if (fuzzyContains(resumeLower, pLower)) {
      nearMatch = true;
    } else {
      continue;
    }

    let occurrences = countPhraseOccurrences(resumeLower, pLower, nearMatch);
    if (occurrences < 1) occurrences = 1;

    allMatched.push({
      text: phrase,
      nearMatch,
      occurrences,
    });
  }

  const matchedPhraseCount = allMatched.length;
  const totalPhraseOccurrences = allMatched.reduce((sum, m) => sum + m.occurrences, 0);
  const matchedPhrases = [...allMatched]
    .sort((a, b) => b.occurrences - a.occurrences || a.text.localeCompare(b.text))
    .slice(0, 12);

  const jdTokens = significantTokens(jd);
  const resumeTokens = significantTokens(resumeText);
  const similarityPercent = jaccard(jdTokens, resumeTokens);
  const phraseSummary = formatPhraseOccurrenceSummary(matchedPhraseCount, totalPhraseOccurrences);

  if (similarityPercent >= 0.38 || matchedPhraseCount >= 8) {
    flags.push({
      severity: "high",
      title: "High JD language overlap",
      detail: `${Math.round(similarityPercent * 100)}% token overlap with posting; ${phraseSummary}. Resumes may be AI-tailored to the posting.`,
    });
  } else if (similarityPercent >= 0.28 || matchedPhraseCount >= 5) {
    flags.push({
      severity: "medium",
      title: "Moderate JD mirroring",
      detail: `${Math.round(similarityPercent * 100)}% overlap; ${phraseSummary}. Verify claims in screening.`,
    });
  } else if (matchedPhraseCount >= 3) {
    flags.push({
      severity: "low",
      title: "Some JD phrasing repeated",
      detail: `${phraseSummary}—normal for qualified candidates, but confirm depth.`,
    });
  }

  const criteriaEcho = countCriteriaEcho(resumeText, requisition);
  if (criteriaEcho >= 0.75 && requisition.mustHaves.length >= 3) {
    flags.push({
      severity: "high",
      title: "Must-have list echoed in resume order",
      detail: "Resume appears to restate most must-haves in similar sequence to your criteria—possible posting mirror.",
    });
  }

  const buzzDensity = buzzwordDensity(resumeText);
  if (buzzDensity >= 0.12) {
    flags.push({
      severity: "medium",
      title: "High buzzword density",
      detail: "Many generic role terms with limited project-specific nouns (client, site, contract type).",
    });
  }

  const riskLevel = flags.some((f) => f.severity === "high")
    ? "high"
    : flags.some((f) => f.severity === "medium")
      ? "medium"
      : flags.length
        ? "low"
        : "none";

  return {
    riskLevel,
    similarityPercent: Math.round(similarityPercent * 100),
    matchedPhrases,
    matchedPhraseCount,
    totalPhraseOccurrences,
    flags,
  };
}

function formatPhraseOccurrenceSummary(phraseCount, occurrenceCount) {
  const p = phraseCount === 1 ? "phrase" : "phrases";
  const t = occurrenceCount === 1 ? "time" : "times";
  return `${phraseCount} JD ${p} found across ${occurrenceCount} ${t} on the resume`;
}

function countPhraseOccurrences(resumeLower, phraseLower, nearMatch) {
  const exact = countSubstringOccurrences(resumeLower, phraseLower);
  if (exact > 0) return exact;

  const tokens = phraseLower.split(/\W+/).filter((w) => w.length > 3);
  if (tokens.length < 3) return nearMatch ? 1 : 0;

  const probes = [];
  for (let len = Math.min(4, tokens.length); len >= 3; len--) {
    for (let i = 0; i <= tokens.length - len; i++) {
      probes.push(tokens.slice(i, i + len).join(" "));
    }
  }

  let best = 0;
  for (const probe of probes) {
    if (probe.length < 10) continue;
    best = Math.max(best, countSubstringOccurrences(resumeLower, probe));
  }
  if (best > 0) return best;

  if (!nearMatch) return 0;

  const chunks = resumeLower.split(/[\n.;|•]+/).filter((c) => c.trim().length > 10);
  let chunkHits = 0;
  for (const chunk of chunks) {
    const hit = tokens.filter((t) => chunk.includes(t)).length;
    if (hit / tokens.length >= 0.85) chunkHits++;
  }
  return chunkHits;
}

function countSubstringOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += Math.max(needle.length, 1);
  }
  return count;
}

function collectPhrases(jd, requisition) {
  const phrases = new Set();
  const lines = jd.split(/\r?\n/).map((l) => l.replace(/^[-•*●▪◦]\s+/, "").trim()).filter((l) => l.length > 15 && l.length < 200);
  lines.forEach((l) => phrases.add(l));

  for (const item of [...requisition.mustHaves, ...requisition.preferred]) {
    if (item.text.length > 15) phrases.add(item.text);
  }

  const words = jd.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  for (let i = 0; i < words.length - 3; i++) {
    const ng = words.slice(i, i + 4).join(" ");
    if (ng.length >= 15) phrases.add(ng);
  }
  return [...phrases];
}

function countCriteriaEcho(resumeText, requisition) {
  const resume = resumeText.toLowerCase();
  const musts = requisition.mustHaves.map((m) => m.text.toLowerCase());
  if (!musts.length) return 0;
  let hits = 0;
  let lastIdx = -1;
  let inOrder = 0;
  for (const m of musts) {
    const tokens = m.split(/\W+/).filter((w) => w.length > 3).slice(0, 4);
    if (!tokens.length) continue;
    const probe = tokens.join(" ");
    const idx = resume.indexOf(probe);
    if (idx >= 0) {
      hits++;
      if (idx > lastIdx) inOrder++;
      lastIdx = idx;
    }
  }
  return hits / musts.length >= 0.6 ? inOrder / musts.length : (hits / musts.length) * 0.5;
}

function buzzwordDensity(text) {
  const buzz = [
    "scheduling", "scheduler", "primavera", "baseline", "project controls", "cost engineer",
    "collaborative", "detail-oriented", "results-driven", "synergy", "stakeholder", "deliverables",
    "cross-functional", "proven track record", "dynamic", "self-starter",
  ];
  const lower = text.toLowerCase();
  const words = lower.split(/\W+/).filter(Boolean);
  if (!words.length) return 0;
  let buzzCount = 0;
  for (const b of buzz) {
    if (lower.includes(b)) buzzCount += b.split(/\s+/).length;
  }
  const projectNouns = (lower.match(/\b(epc|data center|nuclear|refinery|mw|\$[\d]|client|contractor|subcontractor)\b/g) || []).length;
  if (projectNouns >= 3) return Math.max(0, buzzCount / words.length - 0.04);
  return buzzCount / words.length;
}

function fuzzyContains(haystack, needle) {
  const tokens = needle.split(/\W+/).filter((w) => w.length > 3);
  if (tokens.length < 3) return false;
  const hit = tokens.filter((t) => haystack.includes(t)).length;
  return hit / tokens.length >= 0.85;
}

function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function significantTokens(text) {
  const stop = new Set([
    "the", "and", "for", "with", "from", "that", "this", "your", "have", "has", "are", "was", "will",
    "our", "you", "all", "any", "can", "job", "work", "team", "role", "ability", "including", "required",
  ]);
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3 && !stop.has(w));
}

export function mirroringPenalty(riskLevel) {
  return { high: 22, medium: 12, low: 5, none: 0, unknown: 0 }[riskLevel] ?? 0;
}
