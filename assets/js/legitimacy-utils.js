/** Shared token helpers for legitimacy analysis. */

export function significantTokens(text) {
  const stop = new Set([
    "the", "and", "for", "with", "from", "that", "this", "your", "have", "has", "are", "was", "will",
    "able", "experience", "years", "year", "role", "work", "using", "including", "level", "must", "read",
    "our", "you", "all", "any", "can", "job", "team", "ability", "required", "preferred",
  ]);
  return String(text || "")
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !stop.has(w));
}
