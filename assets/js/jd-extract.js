/**
 * Heuristic JD extraction using domain pack section labels.
 */
export function extractFromJd(jdText, domainPack) {
  const labels = domainPack.jdSectionLabels || {};
  const mustLabels = (labels.must || []).map((s) => s.toLowerCase());
  const prefLabels = (labels.preferred || []).map((s) => s.toLowerCase());
  const dealLabels = (labels.dealBreaker || []).map((s) => s.toLowerCase());

  const mustHaves = [];
  const preferred = [];
  const dealBreakers = [];

  let section = "unknown";
  const lines = jdText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const bulletRe = /^[-•*●▪◦]\s+|^\d+[.)]\s+/;

  function classifyLine(line) {
    const lower = line.toLowerCase();
    if (mustLabels.some((l) => lower.includes(l))) return "must";
    if (prefLabels.some((l) => lower.includes(l))) return "preferred";
    if (dealLabels.some((l) => lower.includes(l))) return "dealBreaker";
    return section;
  }

  function pushUnique(bucket, text) {
    const t = cleanCriterion(text);
    if (!t || t.length < 4) return;
    if (bucket.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    bucket.push(t);
  }

  for (const raw of lines) {
    const line = raw.replace(bulletRe, "").trim();
    const lower = raw.toLowerCase();

    if (mustLabels.some((l) => lower === l || lower.startsWith(l + ":"))) {
      section = "must";
      continue;
    }
    if (prefLabels.some((l) => lower === l || lower.startsWith(l + ":"))) {
      section = "preferred";
      continue;
    }
    if (dealLabels.some((l) => lower === l || lower.startsWith(l + ":"))) {
      section = "dealBreaker";
      continue;
    }

    const inferred = classifyLine(raw);
    if (inferred !== "unknown") section = inferred;

    const isBullet = bulletRe.test(raw) || raw.length < 120;
    if (!isBullet && section === "unknown") continue;

    const text = bulletRe.test(raw) ? line : raw;
    if (text.length < 6) continue;

    if (section === "must" || lineScoreMust(lower, domainPack)) {
      pushUnique(mustHaves, text);
    } else if (section === "preferred" || lineScorePreferred(lower, domainPack)) {
      pushUnique(preferred, text);
    } else if (section === "dealBreaker") {
      pushUnique(dealBreakers, text);
    } else if (lineScoreMust(lower, domainPack)) {
      pushUnique(mustHaves, text);
    } else if (lineScorePreferred(lower, domainPack)) {
      pushUnique(preferred, text);
    }
  }

  return {
    mustHaves: mustHaves.map((text) => ({ text, source: "jd", active: true })),
    preferred: preferred.map((text) => ({ text, source: "jd", active: true })),
    dealBreakers: dealBreakers.map((text) => ({ text, source: "jd", active: true })),
  };
}

function lineScoreMust(lower, pack) {
  const hints = pack.keywordHints?.must || [];
  return hints.some((h) => lower.includes(h.toLowerCase()));
}

function lineScorePreferred(lower, pack) {
  const hints = pack.keywordHints?.preferred || [];
  return hints.some((h) => lower.includes(h.toLowerCase()));
}

function cleanCriterion(text) {
  return text
    .replace(/^[-•*●▪◦]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

export function mergeCriteria(existing, extracted, packSeeds) {
  const byText = (list) => {
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const key = item.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  };

  const withIds = (items) =>
    items.map((item) => ({
      id: item.id || crypto.randomUUID?.() || String(Date.now() + Math.random()),
      text: item.text,
      source: item.source || "manual",
      active: item.active !== false,
    }));

  const combined = {
    mustHaves: withIds([...packSeeds.mustHaves, ...existing.mustHaves, ...extracted.mustHaves]),
    preferred: withIds([...packSeeds.preferred, ...existing.preferred, ...extracted.preferred]),
    dealBreakers: withIds([...packSeeds.dealBreakers, ...existing.dealBreakers, ...extracted.dealBreakers]),
  };

  return {
    mustHaves: byText(combined.mustHaves),
    preferred: byText(combined.preferred),
    dealBreakers: byText(combined.dealBreakers),
  };
}
