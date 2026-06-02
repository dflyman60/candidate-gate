import { loadManifest, loadDomainPack, criteriaFromPack } from "./domain-packs.js";
import { extractFromJd, mergeCriteria } from "./jd-extract.js";
import { extractTextFromPdf } from "./resume-parse.js";
import { scoreCandidate } from "./score.js";
import {
  loadState,
  saveState,
  uuid,
  getRequisition,
  upsertRequisition,
  deleteRequisition,
} from "./storage.js";

const $ = (sel, root = document) => root.querySelector(sel);

let state = loadState();
let manifest = null;
let currentPack = null;
let editorDraft = null;
let evaluateReqId = null;
let lastScorecard = null;
let resumeTextCache = "";

const views = {
  library: $("#view-library"),
  editor: $("#view-editor"),
  evaluate: $("#view-evaluate"),
  scorecard: $("#view-scorecard"),
};

init();

async function init() {
  manifest = await loadManifest();
  bindGlobal();
  renderLibrary();
  showView("library");
}

function bindGlobal() {
  $("#btn-new-requisition")?.addEventListener("click", () => openEditor(null));
  $("#btn-back-library")?.addEventListener("click", () => showView("library"));
  $("#btn-back-library-editor")?.addEventListener("click", () => {
    if (confirm("Discard unsaved changes?")) showView("library");
  });
  $("#btn-save-requisition")?.addEventListener("click", saveEditor);
  $("#btn-extract-jd")?.addEventListener("click", runExtract);
  $("#btn-evaluate-nav")?.addEventListener("click", () => {
    state = loadState();
    if (!state.requisitions.length) {
      alert("Create and save a requisition first.");
      showView("library");
      return;
    }
    openEvaluate();
  });
  $("#btn-back-evaluate")?.addEventListener("click", () => showView("evaluate"));
  $("#btn-run-score")?.addEventListener("click", runScore);
  $("#btn-copy-scorecard")?.addEventListener("click", copyScorecard);
  $("#btn-print-scorecard")?.addEventListener("click", () => window.print());
}

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    if (el) el.hidden = key !== name;
  });
  document.body.dataset.view = name;
  if (name === "library") renderLibrary();
}

async function openEditor(reqId) {
  const defaultPackId = manifest?.defaultPackId || "project-controls";
  currentPack = await loadDomainPack(defaultPackId);

  if (reqId) {
    const req = getRequisition(state, reqId);
    if (!req) return;
    if (req.domainPackId && req.domainPackId !== currentPack.packId) {
      currentPack = await loadDomainPack(req.domainPackId);
    }
    editorDraft = JSON.parse(JSON.stringify(req));
  } else {
    const seeds = criteriaFromPack(currentPack, "pack");
    editorDraft = {
      id: uuid(),
      domainPackId: currentPack.packId,
      title: "",
      jdRaw: "",
      mustHaves: seeds.mustHaves,
      preferred: seeds.preferred,
      dealBreakers: seeds.dealBreakers,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  renderEditor();
  showView("editor");
}

function renderEditor() {
  $("#editor-title").textContent = editorDraft.id && getRequisition(state, editorDraft.id)
    ? "Edit requisition"
    : "New requisition";
  $("#req-title").value = editorDraft.title || "";
  $("#req-jd").value = editorDraft.jdRaw || "";
  $("#editor-pack-label").textContent = currentPack?.title || editorDraft.domainPackId;

  renderCriteriaList("must", editorDraft.mustHaves, $("#list-must"));
  renderCriteriaList("preferred", editorDraft.preferred, $("#list-preferred"));
  renderCriteriaList("deal", editorDraft.dealBreakers, $("#list-deal"));
}

function renderCriteriaList(kind, items, container) {
  if (!container) return;
  container.innerHTML = "";
  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "criteria-row";
    row.innerHTML = `
      <input type="text" value="${escapeAttr(item.text)}" data-kind="${kind}" data-index="${index}" aria-label="Criterion" />
      <button type="button" class="icon-btn" data-remove="${kind}" data-index="${index}" title="Remove">×</button>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => syncCriteriaFromDom());
  });
  container.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.remove;
      const index = Number(btn.dataset.index);
      const key = kindKey(kind);
      editorDraft[key].splice(index, 1);
      renderEditor();
    });
  });
}

function kindKey(kind) {
  if (kind === "must") return "mustHaves";
  if (kind === "preferred") return "preferred";
  return "dealBreakers";
}

function syncCriteriaFromDom() {
  ["must", "preferred", "deal"].forEach((kind) => {
    const key = kindKey(kind);
    const container = $(`#list-${kind === "deal" ? "deal" : kind}`);
    const inputs = container?.querySelectorAll("input") || [];
    editorDraft[key] = [...inputs].map((input, i) => ({
      id: editorDraft[key][i]?.id || uuid(),
      text: input.value.trim(),
      source: editorDraft[key][i]?.source || "manual",
    })).filter((x) => x.text);
  });
}

function addCriterion(kind) {
  syncCriteriaFromDom();
  const key = kindKey(kind);
  editorDraft[key].push({ id: uuid(), text: "", source: "manual" });
  renderEditor();
  const container = $(`#list-${kind === "deal" ? "deal" : kind}`);
  const last = container?.querySelector(".criteria-row:last-child input");
  last?.focus();
}

window.addCriterion = addCriterion;

async function runExtract() {
  syncCriteriaFromDom();
  const jd = $("#req-jd")?.value?.trim();
  if (!jd) {
    alert("Paste a job description first.");
    return;
  }
  editorDraft.jdRaw = jd;
  const extracted = extractFromJd(jd, currentPack);
  const seeds = criteriaFromPack({ seedMustHaves: [], seedPreferred: [], seedDealBreakers: [] });
  editorDraft = {
    ...editorDraft,
    ...mergeCriteria(
      {
        mustHaves: editorDraft.mustHaves,
        preferred: editorDraft.preferred,
        dealBreakers: editorDraft.dealBreakers,
      },
      extracted,
      seeds
    ),
  };
  renderEditor();
}

function saveEditor() {
  syncCriteriaFromDom();
  editorDraft.title = $("#req-title")?.value?.trim() || "Untitled requisition";
  editorDraft.jdRaw = $("#req-jd")?.value?.trim() || "";
  editorDraft.updatedAt = new Date().toISOString();
  if (!editorDraft.createdAt) editorDraft.createdAt = editorDraft.updatedAt;

  state = upsertRequisition(state, editorDraft);
  saveState(state);
  showView("library");
}

function renderLibrary() {
  const list = $("#requisition-list");
  const empty = $("#library-empty");
  if (!list) return;

  state = loadState();
  const reqs = [...state.requisitions].sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
  );

  if (!reqs.length) {
    list.innerHTML = "";
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  list.innerHTML = reqs
    .map(
      (r) => `
    <article class="req-card" data-id="${r.id}">
      <div class="req-card-main">
        <h3>${escapeHtml(r.title)}</h3>
        <p class="muted">${escapeHtml(r.domainPackId || "project-controls")} · ${r.mustHaves?.length || 0} must · ${formatDate(r.updatedAt)}</p>
      </div>
      <div class="req-card-actions">
        <button type="button" class="secondary" data-edit="${r.id}">Edit</button>
        <button type="button" class="primary" data-eval="${r.id}">Evaluate</button>
        <button type="button" class="danger-text" data-delete="${r.id}">Delete</button>
      </div>
    </article>
  `
    )
    .join("");

  list.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openEditor(btn.dataset.edit))
  );
  list.querySelectorAll("[data-eval]").forEach((btn) =>
    btn.addEventListener("click", () => openEvaluate(btn.dataset.eval))
  );
  list.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (confirm("Delete this requisition?")) {
        state = deleteRequisition(state, btn.dataset.delete);
        saveState(state);
        renderLibrary();
      }
    })
  );
}

function openEvaluate(preselectedId) {
  state = loadState();
  evaluateReqId = preselectedId || null;
  const select = $("#evaluate-requisition");
  if (!select) return;

  select.innerHTML = state.requisitions
    .map(
      (r) =>
        `<option value="${r.id}" ${r.id === evaluateReqId ? "selected" : ""}>${escapeHtml(r.title)}</option>`
    )
    .join("");

  if (!state.requisitions.length) {
    select.innerHTML = `<option value="">No saved requisitions</option>`;
  } else if (!evaluateReqId) {
    evaluateReqId = state.requisitions[0].id;
    select.value = evaluateReqId;
  }

  select.onchange = () => {
    evaluateReqId = select.value;
    resetDropZone();
  };

  evaluateReqId = select.value || evaluateReqId;
  resetDropZone();
  showView("evaluate");
}

function resetDropZone() {
  resumeTextCache = "";
  lastScorecard = null;
  const preview = $("#resume-preview");
  if (preview) preview.textContent = "";
  const status = $("#drop-status");
  if (status) status.textContent = "Drop a resume PDF here or click to browse";
  const fileInput = $("#resume-file");
  if (fileInput) fileInput.value = "";
}

function setupDropZone() {
  const zone = $("#drop-zone");
  const fileInput = $("#resume-file");
  if (!zone || !fileInput) return;

  zone.addEventListener("click", () => fileInput.click());
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("dragover");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", async (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file) await handleResumeFile(file);
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (file) await handleResumeFile(file);
  });
}

async function handleResumeFile(file) {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    alert("Please upload a PDF resume.");
    return;
  }
  const status = $("#drop-status");
  if (status) status.textContent = "Reading PDF…";
  try {
    resumeTextCache = await extractTextFromPdf(file);
    if (status) status.textContent = `${file.name} · ${resumeTextCache.length.toLocaleString()} characters extracted`;
    const preview = $("#resume-preview");
    if (preview) preview.textContent = resumeTextCache.slice(0, 600) + (resumeTextCache.length > 600 ? "…" : "");
  } catch (err) {
    if (status) status.textContent = "Could not read PDF";
    alert(err.message || "PDF extraction failed");
  }
}

async function runScore() {
  const req = getRequisition(state, evaluateReqId);
  if (!req) {
    alert("Select a saved requisition first.");
    return;
  }
  if (!resumeTextCache) {
    alert("Drop a resume PDF first.");
    return;
  }
  const pack = await loadDomainPack(req.domainPackId || manifest.defaultPackId);
  lastScorecard = scoreCandidate(resumeTextCache, req, pack);
  renderScorecard(req, lastScorecard);
  showView("scorecard");
}

function renderScorecard(req, sc) {
  const rec = sc.recommendation;
  $("#score-overall").textContent = sc.overall;
  const badge = $("#score-recommendation");
  badge.textContent = rec;
  badge.className = `rec-badge rec-${recClass(rec)}`;

  $("#score-meta").textContent = `${req.title} · scored ${formatDate(sc.scoredAt)} · evidence-based v2.5`;

  renderMirroring(sc.mirroring);
  renderCoverage("#must-coverage", sc.mustHaveCoverage, true);
  renderCoverage("#pref-coverage", sc.preferredCoverage, false);
  renderFlags(sc);

  const claims = $("#claim-summary");
  if (claims) {
    claims.innerHTML = sc.resumeClaimSummary
      .map((c) => `<li>${escapeHtml(c)}</li>`)
      .join("");
  }

  $("#screening-question").textContent = sc.suggestedScreeningQuestion;

  const kitList = $("#screen-kit-list");
  if (kitList && sc.screenKit?.questions?.length) {
    kitList.innerHTML = sc.screenKit.questions
      .map(
        (q) => `
      <li class="screen-kit-item">
        <span class="conf-badge conf-${q.confidence}">${escapeHtml(q.confidence)}</span>
        ${q.legitimacy ? `<span class="leg-badge leg-${legClass(q.legitimacy)}">${escapeHtml(q.legitimacy)}</span>` : ""}
        ${q.notOnResume ? `<span class="leg-badge leg-not-on-resume">Not on resume</span>` : ""}
        <p class="evidence-label">Requisition requirement (from job description)</p>
        <strong class="criterion-text">${escapeHtml(q.criterion)}</strong>
        <p class="screen-kit-question">${escapeHtml(q.question)}</p>
        ${q.snippet
          ? `<p class="evidence-label">Closest resume text (may not state this requirement) · ${escapeHtml(q.sectionLabel || "matched text")}:</p>
             <p class="muted snippet">“${escapeHtml(q.snippet.slice(0, 120))}${q.snippet.length > 120 ? "…" : ""}”</p>
             ${q.matchedTokens?.length ? `<p class="muted match-note">Loose keyword overlap: ${escapeHtml(q.matchedTokens.join(", "))}</p>` : ""}`
          : `<p class="evidence-label muted">This wording does not appear on the resume.</p>`}
      </li>`
      )
      .join("");
  } else if (kitList) {
    kitList.innerHTML = "";
  }
}

function renderMirroring(mirroring) {
  const el = $("#mirroring-panel");
  if (!el || !mirroring) return;

  const riskClass = `mirror-${mirroring.riskLevel || "none"}`;
  let html = `
    <div class="mirror-summary ${riskClass}">
      <strong>Tailoring risk: ${escapeHtml(mirroring.riskLevel || "unknown")}</strong>
      <span class="muted"> · ${mirroring.similarityPercent ?? 0}% JD token overlap</span>
    </div>`;

  if (mirroring.flags?.length) {
    html += mirroring.flags
      .map(
        (f) => `
      <div class="flag-item flag-${f.severity}">
        <strong>${escapeHtml(f.title)}</strong>
        <span>${escapeHtml(f.detail)}</span>
      </div>`
      )
      .join("");
  }

  if (mirroring.matchedPhrases?.length) {
    html += `<details class="mirror-phrases"><summary>Matched JD phrases (${mirroring.matchedPhrases.length})</summary><ul>`;
    html += mirroring.matchedPhrases.map((p) => `<li>${escapeHtml(p)}</li>`).join("");
    html += `</ul></details>`;
  }

  el.innerHTML = html;
}

function renderFlags(sc) {
  const dealEl = $("#deal-risks");
  if (!dealEl) return;

  const items = [
    ...(sc.dealBreakerRisks || []).map((d) => ({
      severity: "high",
      title: d.text,
      detail: d.reason,
    })),
    ...(sc.consistencyFlags || []),
  ];

  const unique = [];
  const seen = new Set();
  for (const item of items) {
    const key = item.title + item.detail;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  if (!unique.length) {
    dealEl.innerHTML = `<p class="muted">No deal-breaker or consistency flags triggered.</p>`;
    return;
  }

  dealEl.innerHTML = unique
    .map(
      (f) => `
    <div class="flag-item flag-${f.severity}">
      <strong>${escapeHtml(f.title)}</strong>
      <span>${escapeHtml(f.detail)}</span>
    </div>`
    )
    .join("");
}

function renderCoverage(sel, coverage, showSubstantiated) {
  const el = $(sel);
  if (!el) return;
  const bar = `<div class="coverage-bar"><div class="coverage-fill" style="width:${coverage.percent}%"></div></div>`;
  const sub = showSubstantiated
    ? ` · <strong>${coverage.substantiatedPercent ?? 0}%</strong> supported in experience`
    : "";
  const mirrorNote = coverage.mirrored
    ? ` · <strong>${coverage.mirrored}</strong> likely JD-mirrored`
    : "";
  const summary = `<p><strong>${coverage.percent}%</strong> evidence + legitimacy weighted${sub}${mirrorNote} · ${coverage.high} high · ${coverage.medium} medium · ${coverage.low} keyword-only</p>`;
  const items = (coverage.items || []).map((item) => renderCriterionRow(item)).join("");
  el.innerHTML = bar + summary + `<div class="coverage-items">${items}</div>`;
}

function renderCriterionRow(item) {
  const conf = item.confidence || (item.matched ? "low" : "none");
  const leg = item.legitimacy;
      const evidenceBlock = item.snippet
        ? `<div class="evidence-block">
            <p class="evidence-label">${item.incidentalSnippet ? "Closest incidental text (requirement not stated)" : "Resume evidence for this rating"}${item.sectionLabel ? ` · ${escapeHtml(item.sectionLabel)}` : ""}:</p>
            <p class="snippet">“${escapeHtml(item.snippet.slice(0, 220))}${item.snippet.length > 220 ? "…" : ""}”</p>
          </div>`
        : `<p class="evidence-label muted">No resume excerpt matched this requirement.</p>`;

  const legBlock = leg
    ? `<div class="legitimacy-block">
        <span class="leg-badge leg-${leg.tier}">${escapeHtml(leg.label)}</span>
        ${leg.jdEchoPercent != null ? `<span class="jd-echo">${leg.jdEchoPercent}% resume echoes requirement</span>` : ""}
        <p class="leg-summary muted">${escapeHtml(leg.summary)}</p>
        ${renderIntentChecklist(leg.intent)}
      </div>`
    : "";

  return `
    <div class="coverage-item conf-${conf}">
      <div class="coverage-badges">
        <span class="conf-badge conf-${conf}">${escapeHtml(item.confidenceLabel || conf)}</span>
      </div>
      <div class="coverage-item-body">
        <p class="evidence-label">Requisition requirement</p>
        <span class="criterion-text">${escapeHtml(item.text)}</span>
        ${evidenceBlock}
        ${legBlock}
      </div>
    </div>`;
}

function renderIntentChecklist(intent) {
  if (!intent?.length) return "";
  const rows = intent
    .filter((i) => i.status !== "na")
    .map((i) => {
      const icon = i.status === "met" ? "✓" : "○";
      const cls = i.status === "met" ? "intent-met" : "intent-miss";
      return `<li class="${cls}"><span>${icon}</span> ${escapeHtml(i.label)}</li>`;
    })
    .join("");
  if (!rows) return "";
  return `<div class="intent-checklist"><p class="evidence-label">Requirement intent</p><ul>${rows}</ul></div>`;
}

function legClass(label) {
  if (!label) return "unknown";
  if (label.includes("mirrored")) return "likely-mirrored";
  if (label.includes("Self-reported")) return "self-reported";
  if (label.includes("Supported")) return "supported";
  if (label.includes("Partially")) return "partial";
  if (label.includes("Not stated")) return "not-on-resume";
  return "unknown";
}

function recClass(rec) {
  if (rec === "Submit") return "submit";
  if (rec === "Verify Further") return "verify";
  return "reject";
}

function copyScorecard() {
  const text = $("#scorecard-printable")?.innerText;
  if (!text) return;
  navigator.clipboard.writeText(text).then(
    () => alert("Scorecard copied to clipboard."),
    () => alert("Copy failed — select and copy manually.")
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

setupDropZone();
