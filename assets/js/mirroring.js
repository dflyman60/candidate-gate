/** Detect resume language that mirrors the job description (AI-tailoring signal). */

import { activeCriteria } from "./criteria.js";

const PHRASE_STOP = new Set([
  "the", "and", "for", "with", "from", "that", "this", "your", "have", "has", "are", "was", "will",
  "our", "you", "all", "any", "can", "job", "work", "team", "role", "ability", "including", "required",
  "must", "should", "would", "their", "they", "them", "been", "being", "such", "into", "about",
]);

export function analyzeJdMirroring(resumeText, requisition) {
  const jd = requisition.jdRaw || "";
  const flags = [];
  if (!jd || jd.length < 80) {
    return {
      riskLevel: "unknown",
      similarityPercent: 0,
      matchedPhrases: [],
      matchedPhraseCount: 0,
      jdPhrasesScanned: 0,
      totalPhraseOccurrences: 0,
      flags: [{ severity: "low", title: "No JD on file", detail: "Save the full job description with this requisition for mirroring analysis." }],
    };
  }

  const jdPhrases = collectPhrases(jd, requisition);
  const jdPhrasesScanned = jdPhrases.length;
  const resumeLower = resumeText.toLowerCase();
  const allMatched = [];

  for (const phrase of jdPhrases) {
    const hit = phraseMatchesResume(resumeLower, phrase);
    if (!hit.match) continue;

    const occurrences = countPhraseOccurrences(resumeLower, phrase.toLowerCase(), hit.near);
    if (occurrences < 1) continue;

    allMatched.push({
      text: phrase,
      nearMatch: hit.near,
      occurrences,
    });
  }

  const deduped = dedupeMatchedPhrases(allMatched);
  const matchedPhraseCount = deduped.length;
  const totalPhraseOccurrences = deduped.reduce((sum, m) => sum + m.occurrences, 0);
  const matchedPhrases = [...deduped]
    .sort((a, b) => {
      if (a.nearMatch !== b.nearMatch) return a.nearMatch ? 1 : -1;
      return b.occurrences - a.occurrences || a.text.localeCompare(b.text);
    })
    .slice(0, 12);

  const jdTokens = significantTokens(jd);
  const resumeTokens = significantTokens(resumeText);
  const similarityPercent = jaccard(jdTokens, resumeTokens);
  const phraseSummary = formatPhraseOccurrenceSummary(
    matchedPhraseCount,
    jdPhrasesScanned,
    totalPhraseOccurrences
  );
  const matchedRatio = jdPhrasesScanned ? matchedPhraseCount / jdPhrasesScanned : 0;
  const exactMatchCount = deduped.filter((m) => !m.nearMatch).length;
  const simPct = Math.round(similarityPercent * 100);

  if (similarityPercent >= 0.38 || (exactMatchCount >= 3 && matchedRatio >= 0.2)) {
    flags.push({
      severity: "high",
      title: "High JD language overlap",
      detail: `${simPct}% token overlap with posting; ${phraseSummary}. Resumes may be AI-tailored to the posting.`,
    });
  } else if (similarityPercent >= 0.28 || (exactMatchCount >= 2 && matchedPhraseCount >= 4)) {
    flags.push({
      severity: "medium",
      title: "Moderate JD mirroring",
      detail: `${simPct}% overlap; ${phraseSummary}. Verify claims in screening.`,
    });
  } else if (matchedPhraseCount >= 2 && (exactMatchCount >= 1 || matchedPhraseCount >= 3)) {
    flags.push({
      severity: "low",
      title: "Some JD phrasing repeated",
      detail: `${phraseSummary}—normal for qualified candidates, but confirm depth.`,
    });
  }

  const criteriaEcho = countCriteriaEcho(resumeText, requisition);
  const mustActive = activeCriteria(requisition.mustHaves);
  if (criteriaEcho >= 0.75 && mustActive.length >= 3) {
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
    jdPhrasesScanned,
    totalPhraseOccurrences,
    flags,
  };
}

/** JD lines, sentences, and criteria only — no sliding word windows. */
function collectPhrases(jd, requisition) {
  const phrases = new Set();

  const add = (raw) => {
    const t = raw.replace(/\s+/g, " ").trim();
    if (isSubstantivePhrase(t)) phrases.add(t);
  };

  for (const line of jd.split(/\r?\n/).map((l) => l.replace(/^[-•*●▪◦]\s+/, "").trim()).filter(Boolean)) {
    if (line.length <= 220) add(line);
    if (line.length > 100) {
      line.split(/(?<=[.!?;])\s+/).forEach((part) => add(part));
    }
  }

  jd.split(/(?<=[.!?])\s+/).forEach((s) => add(s));

  for (const item of [...activeCriteria(requisition.mustHaves), ...activeCriteria(requisition.preferred)]) {
    add(item.text);
  }

  return [...phrases];
}

function isSubstantivePhrase(text) {
  if (text.length < 28 || text.length > 240) return false;
  const tokens = phraseTokens(text);
  if (tokens.length < 5) return false;
  const sig = tokens.filter((t) => !PHRASE_STOP.has(t));
  return sig.length >= 5;
}

function phraseTokens(text) {
  return text.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
}

function phraseMatchesResume(resumeLower, phrase) {
  const pLower = phrase.toLowerCase();
  if (resumeLower.includes(pLower)) return { match: true, near: false };

  const tokens = phraseTokens(phrase).filter((t) => !PHRASE_STOP.has(t) && t.length > 3);
  if (tokens.length < 6) return { match: false, near: false };

  if (orderedTokenMatch(resumeLower, tokens)) return { match: true, near: true };
  return { match: false, near: false };
}

/** Most significant tokens must appear in JD order within the resume. */
function orderedTokenMatch(haystack, tokens) {
  let pos = 0;
  let matched = 0;
  const window = 120;

  for (const token of tokens) {
    const idx = haystack.indexOf(token, pos);
    if (idx >= 0 && idx - pos <= window) {
      matched++;
      pos = idx + token.length;
    }
  }

  return matched / tokens.length >= 0.88;
}

function dedupeMatchedPhrases(matches) {
  const sorted = [...matches].sort((a, b) => b.text.length - a.text.length);
  const kept = [];

  for (const m of sorted) {
    const lower = m.text.toLowerCase();
    const mSig = new Set(phraseTokens(m.text).filter((t) => !PHRASE_STOP.has(t)));

    const subsumed = kept.some((k) => {
      const kl = k.text.toLowerCase();
      if (kl.includes(lower) && kl.length > lower.length + 10) return true;

      const kSig = new Set(phraseTokens(k.text).filter((t) => !PHRASE_STOP.has(t)));
      let inter = 0;
      for (const t of mSig) if (kSig.has(t)) inter++;
      const union = new Set([...mSig, ...kSig]).size;
      return union > 0 && inter / union >= 0.72;
    });

    if (!subsumed) kept.push(m);
  }
  return kept;
}

function formatPhraseOccurrenceSummary(matchedCount, scannedCount, occurrenceCount) {
  const occ = occurrenceCount === 1 ? "1 occurrence" : `${occurrenceCount} occurrences`;
  if (!scannedCount) {
    return `${matchedCount} JD line${matchedCount === 1 ? "" : "s"} matched (${occ} on resume)`;
  }
  return `${matchedCount} of ${scannedCount} JD lines/phrases matched (${occ} on resume)`;
}

function countPhraseOccurrences(resumeLower, phraseLower, nearMatch) {
  if (nearMatch) return 1;
  return countSubstringOccurrences(resumeLower, phraseLower);
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

function countCriteriaEcho(resumeText, requisition) {
  const resume = resumeText.toLowerCase();
  const musts = activeCriteria(requisition.mustHaves).map((m) => m.text.toLowerCase());
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

function jaccard(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function significantTokens(text) {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3 && !PHRASE_STOP.has(w));
}

export function mirroringPenalty(riskLevel) {
  return { high: 22, medium: 12, low: 5, none: 0, unknown: 0 }[riskLevel] ?? 0;
}
