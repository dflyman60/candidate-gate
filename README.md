# Candidate Gate

Local-first MVP for recruiting validation — project schedulers, cost engineers, and project controls candidates.

## What it does

1. Create a **requisition** from a job description (domain pack seeds + JD extraction).
2. Edit **must-haves**, **preferred skills**, and **deal breakers**.
3. Save to a **library** (browser `localStorage`).
4. **Evaluate** a candidate by dropping a resume PDF.
5. Get a **scorecard**: overall score, Submit / Verify Further / Do Not Submit, coverage, risks, claim summary, screening question.

## Run locally

```bash
cd candidate-gate
chmod +x scripts/serve.sh
./scripts/serve.sh
# → http://localhost:8765/
```

Do not open `index.html` via `file://` — PDF.js and pack JSON need HTTP.

## Domain packs

- Manifest: `data/domain-packs-manifest.json`
- Packs: `data/domain-packs/*.json`
- MVP ships **project-controls** only; add packs (e.g. landscaping) by adding JSON + a manifest entry.

## Deploy (GitHub Pages)

1. Create repo `candidate-gate` on GitHub.
2. Push this project to `main`.
3. Settings → Pages → Deploy from branch `main`, folder `/ (root)`.
4. Live at: `https://<user>.github.io/candidate-gate/`

## Data privacy

All requisitions and scoring run in the browser. Nothing is sent to a server in this MVP.
