# AI Model Development Hub

A small, runnable **AI Coding-first model research workspace** featuring experiment tracking, contract and metric registry, reusable skills, synthetic RL evaluation, release gates, failure analysis and artifact lineage.

> **Synthetic demonstration only.** All experiments, risk metrics, customer-related examples and thresholds are fabricated. This app does **not** train models, access ODPS, perform credit decisions or measure real credit risk.

## Screens

- **Overview**: experiment counts, val/test risk chart, quality gate snapshot and nine-stage development pipeline.
- **Experiments**: create new experiment, choose reward and dataset, execute deterministic synthetic evaluation, compare model results.
- **Contracts**: business rules, dataset constraints, metric definitions and demo release gate.
- **Skills**: discover reusable capabilities with implementation references in `foundation/`.
- **Badcases**: synthetic failure taxonomy and visual distribution.
- **Lineage**: browse data, contract, experiment, checkpoint, evaluation and gate relationships.
- **Knowledge**: linked research conclusions.

## Run locally

Requirements: Python 3.10+, Node.js 20+ and npm.

Terminal A — API:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Terminal B — frontend:

```bash
cd frontend
npm install
npm run dev
```

Visit **http://localhost:5173**. API docs: **http://localhost:8000/docs**.

The backend seeds four example experiments into `backend/hub.sqlite` on first start. To start over, stop the API and delete that SQLite file.

## Test and build

```bash
cd backend && python -m pytest -q
cd frontend && npm run build
```

## Example API workflow

```bash
curl -s http://localhost:8000/api/overview
curl -s -X POST http://localhost:8000/api/experiments \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"Reward ablation","reward":"reward-v5","lr":0.000001,"dataset":"credit-v13"}'
# Use the id returned above:
curl -s -X POST http://localhost:8000/api/experiments/EXP-XXXXXXXX/evaluate
curl -s http://localhost:8000/api/lineage/EXP-XXXXXXXX
```

## Structure

```text
AGENTS.md                  Codex ground rules
foundation/contracts/      Versioned business and metric contracts
foundation/recipes/        Machine-readable workflow recipe
foundation/skills/         Executable skill documentation
backend/app/main.py        FastAPI / SQLite / seeded experiment registry
backend/tests/             API validation tests
frontend/src/              React / TypeScript research console
```

## Design invariants

- **Contract** is the source of truth for definitions, not a prompt fragment.
- **Skill** does work; **Recipe** connects the skills; **Experiment** records exactly what happened.
- **Knowledge** represents evidence-bound conclusions, not unconditional model rules.
- Validation is used for model selection; independent locked test data is for final evaluation.
- The demonstration computes synthetic metrics deterministically. Production training and risk metrics require real evaluator adapters and independent review.
- SQLite is appropriate for this single-user demo; production deployments need authentication, authorization, migration management, run orchestration, artifact storage and observability.

## Next integrations

1. Replace mock dataset manifests with ODPS dataset snapshot identifiers and schema checks.
2. Connect MLflow or your preferred experiment tracker for checkpoint/config lineage.
3. Connect actual training orchestration and immutable evaluation job records.
4. Add gated pull-request workflows for changes to metrics and business rules.
