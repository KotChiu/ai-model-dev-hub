# AI Coding instructions for Model Development Hub

## Ground truth and safety
- This project is a synthetic demonstration. Never represent seeded or simulated metrics as actual model performance.
- Never silently change metric formulas, business contracts, quality gates, or frozen test data.
- Data contract `credit-policy/v3` defines `total_credit_amt` as strategy-baseline credit; do not substitute gold labels.
- Keep validation data for model selection separate from frozen holdout tests. Repeated optimization on holdout is prohibited.
- API modifications should include pytest coverage and preserve explicit artifact lineage.

## Implementation guidance
- Frontend: React + TypeScript + Vite in `frontend/`. Backend: FastAPI + SQLite in `backend/`.
- Run `cd backend && python -m pytest -q`, then `cd frontend && npm run build` before proposing a release.
- Every experiment has a dataset version, reward version, checkpoint, validation metrics, test metrics and gate decision.
- Add skills under `foundation/skills/`; metric and business definitions under `foundation/contracts/`.
