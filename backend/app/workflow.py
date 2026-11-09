"""End-to-end *synthetic* credit research workflow.

Adapters are deliberately mocked. No ODPS query, external label-service call,
model training, or actual credit decision is performed by this module.
"""
import json
import math
import os
import random
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/workflow", tags=["Credit research demo"])
DB = Path(os.getenv("MLH_DB_PATH", str(Path(__file__).resolve().parents[1] / "hub.sqlite")))
Y_FIELDS = ["fpd7", "fpd30", "tpd30", "c_m1", "c_d30"]
FEATURE_FIELDS = [
    "risk_grade", "business_months", "monthly_sales", "debt_ratio",
    "overdue_cnt_12m", "total_credit_amt"
]
TABLES = [
    {"name": "demo_credit_feature_di", "description": "客户经营与风险特征宽表 · Mock ODPS",
     "partitions": ["20261031", "20261024", "20261017"], "fields": FEATURE_FIELDS},
    {"name": "demo_loan_profile_di", "description": "授信画像宽表 · Mock ODPS",
     "partitions": ["20261031", "20261024"], "fields": FEATURE_FIELDS},
]
STAGES = ["sampled", "labeled", "dialogues", "split", "trained", "reported"]


def connection():
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.execute("""CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, payload TEXT NOT NULL
    )""")
    con.commit()
    return con


def save(run):
    run["updated_at"] = datetime.now(timezone.utc).isoformat()
    with connection() as con:
        con.execute(
            "INSERT OR REPLACE INTO workflow_runs (id,updated_at,payload) VALUES (?,?,?)",
            (run["id"], run["updated_at"], json.dumps(run, ensure_ascii=False))
        )


def load(run_id):
    with connection() as con:
        row = con.execute("SELECT payload FROM workflow_runs WHERE id = ?", (run_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Workflow run not found")
    return json.loads(row["payload"])


def ensure(run, stage):
    if run["stage"] != stage:
        raise HTTPException(
            409, f"Expected stage '{stage}', current stage is '{run['stage']}'. Complete the steps in order."
        )


def public(run):
    raw = run["raw_rows"]
    labels = run.get("label_rows", [])
    dialogues = run.get("dialogues", [])
    split = run.get("split", {})
    return {
        "id": run["id"], "name": run["name"], "stage": run["stage"],
        "created_at": run["created_at"], "updated_at": run["updated_at"],
        "source": run["source"], "row_count": len(raw),
        "raw_preview": raw[:5], "label_preview": labels[:5],
        "label_fields": Y_FIELDS,
        "query_preview": dialogues[:3], "query_count": len(dialogues),
        "split": {k: len(v) for k, v in split.items()},
        "split_seed": run.get("split_seed"),
        "training": run.get("training"), "candidates": run.get("candidates", []),
        "report": run.get("report"),
        "adapter": "synthetic-mock", "sql_executed": False
    }


class SampleConfig(BaseModel):
    name: str = Field(default="授信 RL 研发演示", min_length=3, max_length=80)
    table: str
    partition: str
    sql: str = Field(min_length=12, max_length=6000)
    sample_size: int = Field(default=240, ge=50, le=500)
    seed: int = Field(default=42, ge=0, le=1000000)


class SplitConfig(BaseModel):
    test_ratio: float = Field(default=0.2, ge=0.1, le=0.4)
    val_ratio: float = Field(default=0.1, ge=0.05, le=0.3)
    seed: int = Field(default=42, ge=0, le=1000000)


class TrainingConfig(BaseModel):
    epochs: int = Field(default=4, ge=1, le=20)
    learning_rate: float = Field(default=0.000001, gt=0, le=0.01)
    reward_weight: float = Field(default=0.6, ge=0, le=1)
    reward_version: str = Field(default="risk-aware-v1", min_length=2, max_length=80)


def synthetic_rows(sample_size, seed):
    rng = random.Random(seed)
    rows = []
    for i in range(sample_size):
        grade = rng.choice(["A", "B", "B", "C", "C", "D", "E"])
        months = rng.randint(3, 180)
        sales = round(rng.uniform(1.5, 120), 2)
        debt = round(rng.uniform(0.05, 0.95), 3)
        overdue = rng.choices([0, 1, 2, 3], weights=[68, 19, 9, 4])[0]
        credit = round(rng.uniform(5, 70), 2)
        features = {
            "risk_grade": grade,
            "business_months": months,
            "monthly_sales": sales,
            "debt_ratio": debt,
            "overdue_cnt_12m": overdue,
            "total_credit_amt": credit
        }
        rows.append({"sample_id": f"mock_{seed}_{i+1:05d}", "features": features})
    return rows


def synthetic_labels(rows, seed):
    rng = random.Random(seed + 3571)
    outcomes = []
    for row in rows:
        x = row["features"]
        risk = min(0.47, max(0.025, 0.028 + x["debt_ratio"] * 0.11
                            + x["overdue_cnt_12m"] * 0.10
                            + ("ABCDE".index(x["risk_grade"])) * 0.032
                            - x["business_months"] / 2200))
        fpd7 = int(rng.random() < risk * 0.52)
        labels = {
            "fpd7": fpd7,
            "fpd30": int(fpd7 or rng.random() < risk * 0.85),
            "tpd30": int(rng.random() < risk * 0.75),
            "c_m1": int(rng.random() < risk * 1.05),
            "c_d30": int(rng.random() < risk * 0.65),
        }
        outcomes.append({"sample_id": row["sample_id"], "labels": labels})
    return outcomes


def build_query(features):
    """Only features enter the model prompt. No label and no assistant answer."""
    return (
        "你是授信额度决策助手。请根据以下客户画像评估合理的授信策略。\n"
        f"客户风险评级：{features['risk_grade']}\n"
        f"经营月数：{features['business_months']}\n"
        f"月销售额：{features['monthly_sales']}万元\n"
        f"负债率：{features['debt_ratio']:.1%}\n"
        f"近12个月逾期次数：{features['overdue_cnt_12m']}\n"
        f"当前总授信额度（total_credit_amt）：{features['total_credit_amt']}万元\n"
        "请输出授信动作及建议授信金额，并说明主要依据。"
    )


def score(features, reward_weight):
    """Hand-coded illustrative score; NOT inference from a trained model."""
    x = features
    base = (
        0.10 + "ABCDE".index(x["risk_grade"]) * 0.12
        + x["debt_ratio"] * (0.25 + reward_weight * 0.12)
        + x["overdue_cnt_12m"] * (0.13 + reward_weight * 0.03)
        - x["business_months"] / 1000
    )
    return round(max(0.01, min(0.99, base)), 4)


def roc_auc(pairs):
    """Mann-Whitney AUC with mid-rank handling of ties; None for single class."""
    n_pos = sum(label for _, label in pairs)
    n_neg = len(pairs) - n_pos
    if not n_pos or not n_neg:
        return None
    pairs = sorted(pairs, key=lambda p: p[0])
    rank = 1
    rank_sum = 0.0
    i = 0
    while i < len(pairs):
        j = i + 1
        while j < len(pairs) and pairs[j][0] == pairs[i][0]:
            j += 1
        midpoint = (rank + rank + j - i - 1) / 2
        rank_sum += midpoint * sum(label for _, label in pairs[i:j])
        rank += j - i
        i = j
    return round((rank_sum - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg), 4)


@router.get("/sources")
def sources():
    return {
        "project": "demo_credit_research",
        "tables": TABLES,
        "label_api": "mock://risk-label-service/v1/batch",
        "label_fields": Y_FIELDS,
        "mode": "mock-only"
    }


@router.get("/runs")
def runs():
    with connection() as con:
        rows = con.execute("SELECT id, updated_at, payload FROM workflow_runs ORDER BY updated_at DESC LIMIT 30").fetchall()
    return [{"id": r["id"], "updated_at": r["updated_at"],
             "name": json.loads(r["payload"])["name"],
             "stage": json.loads(r["payload"])["stage"]} for r in rows]


@router.post("/runs", status_code=201)
def create_run(payload: SampleConfig):
    table = next((t for t in TABLES if t["name"] == payload.table), None)
    if table is None or payload.partition not in table["partitions"]:
        raise HTTPException(422, "Table or partition is not in the demo registry")
    sql = payload.sql.strip()
    # This SQL is stored for review, never executed, even when it passes validation.
    if (not re.match(r"(?is)^SELECT\s", sql) or
            re.search(r"(?i)\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE)\b", sql) or
            ";" in sql or "--" in sql or "/*" in sql or "*/" in sql):
        raise HTTPException(422, "Demo only accepts one comment-free SELECT statement")
    if payload.table.lower() not in sql.lower() or payload.partition not in sql:
        raise HTTPException(422, "SQL must reference the selected table and partition")
    created = datetime.now(timezone.utc).isoformat()
    run = {
        "id": "FLOW-" + uuid4().hex[:8].upper(),
        "name": payload.name,
        "stage": "sampled", "created_at": created,
        "source": {"project": "demo_credit_research", "table": payload.table,
                   "partition": payload.partition, "sql": sql,
                   "sample_size": payload.sample_size, "seed": payload.seed},
        "raw_rows": synthetic_rows(payload.sample_size, payload.seed)
    }
    save(run)
    return public(run)


@router.get("/runs/{run_id}")
def get_run(run_id: str):
    return public(load(run_id))


@router.post("/runs/{run_id}/labels")
def attach_labels(run_id: str):
    run = load(run_id)
    ensure(run, "sampled")
    run["label_rows"] = synthetic_labels(run["raw_rows"], run["source"]["seed"])
    run["stage"] = "labeled"
    save(run)
    return public(run)


@router.post("/runs/{run_id}/dialogues")
def convert_dialogues(run_id: str):
    run = load(run_id)
    ensure(run, "labeled")
    run["dialogues"] = [
        {"sample_id": r["sample_id"], "messages": [
            {"role": "user", "content": build_query(r["features"])}
        ]}
        for r in run["raw_rows"]
    ]
    assert all(list(d["messages"][0].keys()) == ["role", "content"] for d in run["dialogues"])
    # The outcome sidecar is separate. Never inject Y fields into model input messages.
    run["stage"] = "dialogues"
    save(run)
    return public(run)


@router.post("/runs/{run_id}/split")
def split_data(run_id: str, config: SplitConfig):
    run = load(run_id)
    ensure(run, "dialogues")
    if config.test_ratio + config.val_ratio >= 0.8:
        raise HTTPException(422, "Training set must retain at least 20% of rows")
    ids = [r["sample_id"] for r in run["dialogues"]]
    random.Random(config.seed).shuffle(ids)
    n_test = round(len(ids) * config.test_ratio)
    n_val = round(len(ids) * config.val_ratio)
    run["split"] = {
        "test": ids[:n_test],
        "val": ids[n_test:n_test+n_val],
        "train": ids[n_test+n_val:]
    }
    run["split_seed"] = config.seed
    run["stage"] = "split"
    save(run)
    return public(run)


@router.post("/runs/{run_id}/train")
def simulate_training(run_id: str, config: TrainingConfig):
    run = load(run_id)
    if run["stage"] not in ("split", "trained"):
        raise HTTPException(409, "Tune candidates only after split and before final test report")
    candidates = run.setdefault("candidates", [])
    if len(candidates) >= 6:
        raise HTTPException(409, "Demo supports at most six tuning candidates per dataset")
    # No optimizer, gradients, GPU job, inference or actual checkpoint exists here.
    history = [
        {"epoch": i, "simulated_loss": round(1.32 / (1 + 0.48 * i + config.reward_weight / 4), 3),
         "simulated_reward": round(min(0.95, 0.23 + i * 0.105 + config.reward_weight * 0.08), 3)}
        for i in range(1, config.epochs + 1)
    ]
    val_ids = run["split"]["val"]
    x_map = {r["sample_id"]: r["features"] for r in run["raw_rows"]}
    y_map = {r["sample_id"]: r["labels"] for r in run["label_rows"]}
    val_auc = roc_auc([
        (score(x_map[sid], config.reward_weight), y_map[sid]["fpd30"])
        for sid in val_ids
    ])
    candidate = {
        "candidate_id": f"C{len(candidates)+1:02d}",
        "mode": "synthetic-trajectory",
        "checkpoint": f"simulated-{run_id}-c{len(candidates)+1}",
        "config": config.model_dump(),
        "history": history, "val_fpd30_auc": val_auc,
        "real_model_trained": False,
        "note": "query-only prompts need rollout and reward for real RL; no model is trained here."
    }
    candidates.append(candidate)
    # Select only on validation. The frozen test split is never inspected here.
    run["training"] = max(candidates, key=lambda c: (
        -1.0 if c["val_fpd30_auc"] is None else c["val_fpd30_auc"]
    ))
    run["stage"] = "trained"
    save(run)
    return public(run)


@router.post("/runs/{run_id}/report")
def generate_report(run_id: str):
    run = load(run_id)
    ensure(run, "trained")
    split = run["split"]
    y_map = {r["sample_id"]: r["labels"] for r in run["label_rows"]}
    x_map = {r["sample_id"]: r["features"] for r in run["raw_rows"]}
    weight = run["training"]["config"]["reward_weight"]
    scored = [
        {"sample_id": sid, "risk_score": score(x_map[sid], weight), "labels": y_map[sid]}
        for sid in split["test"]
    ]
    metrics = []
    for label in Y_FIELDS:
        positives = sum(row["labels"][label] for row in scored)
        metrics.append({
            "label": label, "positives": positives,
            "positive_rate": round(positives / len(scored), 4),
            "auc": roc_auc([(r["risk_score"], r["labels"][label]) for r in scored]),
        })
    # Illustrative review queue: false negatives for fpd30 at a fixed score threshold.
    badcases = [
        {"sample_id": r["sample_id"], "issue": "高风险标签但模拟评分较低",
         "label": "fpd30", "actual": r["labels"]["fpd30"], "risk_score": r["risk_score"]}
        for r in scored if r["labels"]["fpd30"] == 1 and r["risk_score"] < 0.45
    ][:5]
    report = {
        "title": "授信模型研发测试报告（合成演示）",
        "run_id": run_id, "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "DEMO_ONLY", "model_trained": False,
        "source": run["source"],
        "dataset": {"total": len(run["raw_rows"]), "train": len(split["train"]),
                    "val": len(split["val"]), "test": len(split["test"]),
                    "split_seed": run["split_seed"], "test_set_locked": True},
        "training": run["training"],
        "tuning_history": [{"candidate_id": c["candidate_id"], "config": c["config"],
                            "val_fpd30_auc": c["val_fpd30_auc"]} for c in run.get("candidates", [])],
        "selected_candidate": run["training"]["candidate_id"],
        "metrics": metrics, "badcases": badcases,
        "checks": [
            {"name": "SQL 与分区来源已记录", "passed": True},
            {"name": "特征与 Y 标签分离", "passed": True},
            {"name": "训练/验证/测试样本互斥", "passed": len(set(sum(split.values(), []))) == len(run["raw_rows"])},
            {"name": "训练输入仅 user/query，无 assistant/answer", "passed":
                all(len(d["messages"]) == 1 and d["messages"][0]["role"] == "user"
                    and not any(k in d["messages"][0]["content"] for k in Y_FIELDS)
                    for d in run["dialogues"])},
            {"name": "真实模型训练与业务准出", "passed": False, "reason": "当前为 Mock，不具备真实准出能力"},
        ],
        "summary": "已完成模拟的 ODPS 采样、Y 标关联、query-only 转换、数据切分、训练轨迹和锁定测试集报告。AUC 为手工模拟评分与随机合成标签计算，不能代表模型效果。"
    }
    run["report"] = report
    run["stage"] = "reported"
    save(run)
    return public(run)
