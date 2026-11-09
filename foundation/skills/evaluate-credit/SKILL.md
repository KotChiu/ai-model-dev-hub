---
name: evaluate-credit
description: Evaluate a credit-model experiment using registered metrics and demo quality gates.
---

# Credit evaluation

Input: experiment id. Precondition: experiment exists and status is draft.

1. Read the experiment data and reward configuration.
2. Validate contract versions and dataset reference.
3. Invoke `POST /api/experiments/{id}/evaluate` for deterministic synthetic demo metrics.
4. Inspect validation versus holdout metrics separately.
5. Record quality gate decision, artifact lineage and reproducible configuration.
6. Do not reuse holdout metrics to tune the same candidate.

The evaluation implementation in this repository is synthetic; replace it with verified data/model connectors before any production usage.
