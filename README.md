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

## Deploy (Vercel — recommended)

1. Create an empty GitHub repo named `candidate-gate` (no README/license).
2. Push this project:

   ```bash
   git remote add origin https://github.com/dflyman60/candidate-gate.git
   git push -u origin main
   ```

3. [vercel.com](https://vercel.com) → **Add New Project** → import `candidate-gate`.
4. Framework preset: **Other**. Root directory: `./`. Build command: *(leave empty)*. Output: *(leave empty / root)*.
5. Deploy. Your app will be at `https://candidate-gate.vercel.app` (or the URL Vercel assigns).

Optional: add a custom subdomain under your domain in Vercel → Project → Settings → Domains.

## Data privacy

All requisitions and scoring run in the browser. Nothing is sent to a server in this MVP.
