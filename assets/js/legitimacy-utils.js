/** Shared token helpers and technical requirement anchors. */

export function significantTokens(text) {
  const stop = new Set([
    "the", "and", "for", "with", "from", "that", "this", "your", "have", "has", "are", "was", "will",
    "able", "experience", "years", "year", "role", "work", "using", "including", "level", "must", "read",
    "our", "you", "all", "any", "can", "job", "team", "ability", "required", "preferred", "preparation",
    "acceptance", "usable", "analyze", "statements",
  ]);
  return String(text || "")
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !stop.has(w));
}

/** Resume must mention core technical terms from the requirement (drawings, specs, SOW, etc.). */
export function criterionAnchorTokens(criterionText) {
  const lower = (criterionText || "").toLowerCase();
  const anchors = [];

  if (/drawing|blueprint|cad|autocad|markup/i.test(lower)) {
    if (/drawing/i.test(lower)) anchors.push("drawing", "drawings");
    if (/blueprint/i.test(lower)) anchors.push("blueprint");
    if (/cad|autocad/i.test(lower)) anchors.push("cad", "autocad");
    if (/markup/i.test(lower)) anchors.push("markup");
  }
  if (/specification/i.test(lower)) anchors.push("specification", "specifications");
  if (/statements?\s+of\s+work|\bsow\b/i.test(lower)) {
    anchors.push("statement of work", "statements of work", "sow");
  }

  return [...new Set(anchors)];
}

export function requiresTechnicalAnchors(criterionText) {
  return criterionAnchorTokens(criterionText).length > 0;
}

export function resumeMeetsTechnicalAnchors(criterionText, snippet) {
  const anchors = criterionAnchorTokens(criterionText);
  if (!anchors.length) return true;
  const resume = (snippet || "").toLowerCase();
  return anchors.some((a) => resume.includes(a));
}
