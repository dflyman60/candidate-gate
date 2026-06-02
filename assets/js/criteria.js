/** Shared criterion shape: text, source (pack | jd | manual), active flag. */

export function normalizeCriterion(item = {}) {
  return {
    id: item.id || "",
    text: String(item.text || "").trim(),
    source: item.source === "pack" || item.source === "jd" ? item.source : "manual",
    active: item.active !== false,
  };
}

export function normalizeCriteriaList(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => normalizeCriterion(item)).filter((c) => c.text || c.id);
}

/** Criteria included when scoring (active + non-empty text). */
export function activeCriteria(items) {
  return (items || []).filter((c) => c.active !== false && String(c.text || "").trim());
}

export function sourceLabel(source) {
  if (source === "pack") return "Preload";
  if (source === "jd") return "From JD";
  return "Manual";
}

export function sourceClass(source) {
  if (source === "pack") return "criteria-source--pack";
  if (source === "jd") return "criteria-source--jd";
  return "criteria-source--manual";
}
