/** Executive overview for scorecard — pros, cons, upside/downside split. */

import { confidenceDisplayLabel } from "./label-definitions.js";

export function buildExecutiveSummary(req, sc) {
  const mustItems = sc.mustHaveCoverage?.items || [];
  const prefItems = sc.preferredCoverage?.items || [];
  const allItems = [...mustItems, ...prefItems];

  const pros = [];
  const cons = [];
  const criteriaRows = [];

  for (const r of mustItems) {
    criteriaRows.push({ ...rowFromResult(r), bucket: "must" });
  }
  for (const r of prefItems) {
    criteriaRows.push({ ...rowFromResult(r), bucket: "preferred" });
  }

  const mustTotal = mustItems.length || 1;
  const mustHigh = mustItems.filter((r) => r.confidence === "high").length;
  const mustSupported = mustItems.filter((r) => r.legitimacy?.tier === "supported").length;
  const mustMirrored = mustItems.filter((r) => r.legitimacy?.tier === "likely-mirrored").length;
  const mustMissing = mustItems.filter((r) => !r.matched || r.confidence === "none").length;
  const mustWeak = mustItems.filter(
    (r) => r.matched && (r.confidence === "low" || r.confidence === "relevant")
  ).length;

  const prefTotal = prefItems.length;
  const prefStrong = prefItems.filter(
    (r) => r.confidence === "high" || r.legitimacy?.tier === "supported"
  ).length;

  const mirroring = sc.mirroring || {};
  const aiWriting = sc.aiWriting || {};
  const dealRisks = [
    ...(sc.dealBreakerRisks || []).filter((d) => d.risk),
    ...(sc.consistencyFlags || []).filter((f) => f.severity === "high" || f.severity === "medium"),
    ...(mirroring.flags || []).filter((f) => f.severity === "high"),
  ];

  if (mustSupported > 0) {
    pros.push(
      `${mustSupported} of ${mustItems.length} must-have(s) show supported experience evidence (dates, employer, or project context).`
    );
  }
  if (mustHigh > 0) {
    pros.push(`${mustHigh} must-have(s) rated high confidence — substantiated on the resume.`);
    mustItems
      .filter((r) => r.confidence === "high")
      .slice(0, 4)
      .forEach((r) => pros.push(`✓ ${r.text}`));
  }
  if (sc.preferredCoverage?.percent >= 50 && prefTotal > 0) {
    pros.push(
      `Preferred skills: ${sc.preferredCoverage.percent}% weighted coverage (${prefStrong} of ${prefTotal} with strong signals).`
    );
  }
  if (mirroring.riskLevel === "low" || mirroring.riskLevel === "none") {
    pros.push("Low JD tailoring risk — resume language is not heavily mirroring the posting.");
  } else if (mirroring.riskLevel === "unknown") {
    pros.push("JD mirroring not fully assessed — save full job description on the requisition for tailoring checks.");
  }
  if (aiWriting.riskLevel === "none" || aiWriting.riskLevel === "low") {
    pros.push("Few AI-style writing patterns (buzzword/template uniformity).");
  }

  if (mustMissing > 0) {
    cons.push(`${mustMissing} must-have(s) not found or not stated on the resume.`);
    mustItems
      .filter((r) => !r.matched || r.confidence === "none")
      .slice(0, 4)
      .forEach((r) => cons.push(`✗ ${r.text}`));
  }
  if (mustMirrored > 0) {
    cons.push(
      `${mustMirrored} must-have(s) likely mirror JD wording without experience-level proof (AI-tailoring signal).`
    );
    mustItems
      .filter((r) => r.legitimacy?.tier === "likely-mirrored")
      .slice(0, 3)
      .forEach((r) => cons.push(`⚠ ${r.text}`));
  }
  if (mustWeak > 0) {
    cons.push(`${mustWeak} must-have(s) only show keyword-level or weak overlap — verify in a live screen.`);
  }
  if (mirroring.riskLevel === "high" || mirroring.riskLevel === "medium") {
    cons.push(
      `JD tailoring risk: ${mirroring.riskLevel} (${mirroring.similarityPercent ?? 0}% token overlap with posting).`
    );
  }
  if (aiWriting.riskLevel === "high" || aiWriting.riskLevel === "medium") {
    cons.push(
      `AI-assisted writing signals: ${aiWriting.riskLevel} (${aiWriting.aiLikelihood ?? 0}% stylistic likelihood—uniform bullets, buzzwords, or vague claims).`
    );
    (aiWriting.signals || [])
      .filter((s) => s.status === "flag")
      .slice(0, 3)
      .forEach((s) => cons.push(`⚠ ${s.label}: ${s.detail}`));
  }
  if (dealRisks.length) {
    cons.push(`${dealRisks.length} deal-breaker or consistency flag(s) need review before advancing.`);
    dealRisks.slice(0, 3).forEach((d) => {
      const title = d.title || d.text;
      const detail = d.detail || d.reason || "";
      cons.push(detail ? `⚠ ${title} — ${detail}` : `⚠ ${title}`);
    });
  }
  if (sc.overall < 40) {
    cons.push(`Overall score (${sc.overall}) sits below the typical bar for submission without a strong screen.`);
  }

  if (!pros.length) {
    pros.push("No substantiated must-have evidence identified on this resume — screen kit questions are essential.");
  }
  if (!cons.length) {
    cons.push("No major automated risk flags; still confirm claims in a structured interview.");
  }

  const upsidePoints = scoreUpsidePoints(allItems, sc);
  const downsidePoints = scoreDownsidePoints(allItems, sc, dealRisks.length);
  const totalPoints = upsidePoints + downsidePoints || 1;
  const upsidePct = Math.round((upsidePoints / totalPoints) * 100);
  const downsidePct = Math.round((downsidePoints / totalPoints) * 100);

  const bottomLine = bottomLineForRecommendation(sc.recommendation, {
    overall: sc.overall,
    mustPct: sc.mustHaveCoverage?.percent ?? 0,
    mustHigh,
    mustTotal: mustItems.length,
    mustMirrored,
    mirroringRisk: mirroring.riskLevel,
    dealCount: dealRisks.length,
  });

  return {
    title: req?.title || "Candidate",
    recommendation: sc.recommendation,
    overall: sc.overall,
    bottomLine,
    upsidePct,
    downsidePct,
    mustPct: sc.mustHaveCoverage?.percent ?? 0,
    prefPct: sc.preferredCoverage?.percent ?? 0,
    substantiatedPct: sc.mustHaveCoverage?.substantiatedPercent ?? 0,
    pros: [...new Set(pros)],
    cons: [...new Set(cons)],
    criteriaRows,
    drivers: recommendationDrivers(sc.recommendation, sc),
  };
}

function scoreUpsidePoints(items, sc) {
  let pts = 0;
  for (const r of items) {
    if (r.legitimacy?.tier === "supported") pts += 3;
    else if (r.confidence === "high") pts += 2.5;
    else if (r.confidence === "medium") pts += 1.5;
    else if (r.confidence === "relevant") pts += 1;
    else if (r.matched) pts += 0.5;
  }
  if (sc.mirroring?.riskLevel === "low" || sc.mirroring?.riskLevel === "none") pts += 2;
  pts += (sc.preferredCoverage?.percent || 0) / 25;
  return pts;
}

function scoreDownsidePoints(items, sc, dealCount) {
  let pts = 0;
  for (const r of items) {
    if (!r.matched || r.confidence === "none") pts += 3;
    else if (r.legitimacy?.tier === "likely-mirrored") pts += 2.5;
    else if (r.confidence === "low") pts += 1.5;
    else if (r.legitimacy?.tier === "self-reported") pts += 1;
  }
  if (sc.mirroring?.riskLevel === "high") pts += 4;
  else if (sc.mirroring?.riskLevel === "medium") pts += 2;
  pts += dealCount * 1.5;
  return pts;
}

function rowFromResult(r) {
  const tier = r.legitimacy?.tier || "unknown";
  let side = "neutral";
  if (tier === "supported" || r.confidence === "high") side = "upside";
  else if (tier === "likely-mirrored" || !r.matched || r.confidence === "none") side = "downside";
  else if (r.confidence === "low" || tier === "self-reported") side = "downside";

  return {
    text: r.text,
    confidence: r.confidence,
    confidenceLabel: confidenceDisplayLabel(r.confidence),
    legitimacy: r.legitimacy?.label || "—",
    side,
  };
}

function bottomLineForRecommendation(rec, ctx) {
  const { overall, mustPct, mustHigh, mustTotal, mustMirrored, mirroringRisk, dealCount } = ctx;
  if (rec === "Submit") {
    return `This profile scores ${overall} overall with ${mustPct}% must-have coverage and ${mustHigh} of ${mustTotal} core requirements at high confidence. Automated checks support advancing to client submission after your standard screen.`;
  }
  if (rec === "Verify Further") {
    return `This profile scores ${overall} overall — not a clear pass or fail. ${mustHigh} of ${mustTotal} must-haves are substantiated; gaps, mirroring (${mirroringRisk} risk), or ${dealCount} flag(s) mean a structured screen is required before submission.`;
  }
  return `This profile scores ${overall} overall with weak substantiation (${mustHigh}/${mustTotal} high-confidence must-haves, ${mustMirrored} likely JD-mirrored). ${dealCount ? `${dealCount} risk flag(s). ` : ""}Recommendation is to hold or reject until evidence improves or a screen clears material gaps.`;
}

function recommendationDrivers(rec, sc) {
  const drivers = [];
  const must = sc.mustHaveCoverage || {};
  drivers.push(`Must-have weighted coverage: ${must.percent ?? 0}%`);
  drivers.push(`Experience substantiated: ${must.substantiatedPercent ?? 0}% of must-haves`);
  drivers.push(`Preferred weighted coverage: ${sc.preferredCoverage?.percent ?? 0}%`);
  drivers.push(`JD tailoring risk: ${sc.mirroring?.riskLevel || "unknown"}`);
  drivers.push(`AI writing signals: ${sc.aiWriting?.riskLevel || "unknown"} (${sc.aiWriting?.aiLikelihood ?? 0}% stylistic likelihood)`);
  if (rec === "Submit") drivers.push("Threshold met: supported evidence + limited mirroring flags.");
  else if (rec === "Verify Further") drivers.push("Mixed signals: some matches need live verification.");
  else drivers.push("Fails automated bar: weak must coverage, mirroring, or deal-breaker signals.");
  return drivers;
}

export function renderExecutiveSummaryHtml(summary) {
  const recClass = recCssClass(summary.recommendation);

  const criteriaHtml = summary.criteriaRows.length
    ? `<table class="exec-criteria-table">
        <thead><tr><th>Requirement</th><th>Type</th><th>Confidence</th><th>Legitimacy</th><th>Side</th></tr></thead>
        <tbody>
          ${summary.criteriaRows
            .map(
              (r) => `
            <tr class="exec-row exec-row--${r.side}">
              <td>${escapeHtml(r.text)}</td>
              <td>${r.bucket === "must" ? "Must-have" : "Preferred"}</td>
              <td>${escapeHtml(r.confidenceLabel)}</td>
              <td>${escapeHtml(r.legitimacy)}</td>
              <td><span class="exec-side exec-side--${r.side}">${sideLabel(r.side)}</span></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`
    : `<p class="muted">No active criteria were scored.</p>`;

  return `
    <header class="exec-modal-head">
      <h2 id="exec-modal-title">Executive overview</h2>
      <p class="muted exec-modal-sub">${escapeHtml(summary.title)}</p>
    </header>

    <div class="exec-hero">
      <div class="exec-rec rec-${recClass}">${escapeHtml(summary.recommendation)}</div>
      <div class="exec-score">Overall <strong>${summary.overall}</strong></div>
    </div>

    <p class="exec-bottom-line">${escapeHtml(summary.bottomLine)}</p>

    <section class="exec-bars" aria-label="Upside versus downside">
      <h3>Screening balance</h3>
      <div class="exec-bar-pair">
        <div class="exec-bar-row">
          <span class="exec-bar-label">Upside</span>
          <div class="exec-bar-track"><div class="exec-bar-fill exec-bar-fill--up" style="width:${summary.upsidePct}%"></div></div>
          <span class="exec-bar-pct">${summary.upsidePct}%</span>
        </div>
        <div class="exec-bar-row">
          <span class="exec-bar-label">Downside</span>
          <div class="exec-bar-track"><div class="exec-bar-fill exec-bar-fill--down" style="width:${summary.downsidePct}%"></div></div>
          <span class="exec-bar-pct">${summary.downsidePct}%</span>
        </div>
      </div>
      <p class="muted exec-bar-note">Relative weight of substantiated matches vs gaps, weak evidence, mirroring, and flags — not a hire probability.</p>
      <ul class="exec-metrics muted">
        <li>Must-have coverage: <strong>${summary.mustPct}%</strong></li>
        <li>Substantiated must-haves: <strong>${summary.substantiatedPct}%</strong></li>
        <li>Preferred coverage: <strong>${summary.prefPct}%</strong></li>
      </ul>
    </section>

    <div class="exec-columns">
      <section class="exec-pros">
        <h3>Strengths (pros)</h3>
        <ul>${summary.pros.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
      </section>
      <section class="exec-cons">
        <h3>Risks &amp; gaps (cons)</h3>
        <ul>${summary.cons.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
      </section>
    </div>

    <section class="exec-drivers">
      <h3>Why this recommendation</h3>
      <ul>${summary.drivers.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>
    </section>

    <section class="exec-criteria">
      <h3>Criteria breakdown</h3>
      ${criteriaHtml}
    </section>
  `;
}

function recCssClass(rec) {
  if (rec === "Submit") return "submit";
  if (rec === "Verify Further") return "verify";
  if (rec === "Do Not Submit") return "reject";
  return "unknown";
}

function sideLabel(side) {
  if (side === "upside") return "Upside";
  if (side === "downside") return "Downside";
  return "Mixed";
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
