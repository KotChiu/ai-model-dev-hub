"""Synthetic model development demo API. No real customer information is used."""
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DB = Path(os.getenv("MLH_DB_PATH", str(Path(__file__).resolve().parents[1] / "hub.sqlite")))
app = FastAPI(title="AI Model Development Hub", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])

CONTRACTS = [
    {"id": "credit-policy", "name": "授信业务口径", "version": "v3", "kind": "business", "status": "frozen", "detail": "策略基准金额使用 total_credit_amt；禁止用 gold 或未来信息替代。"},
    {"id": "risk-3m30d", "name": "3m30d 金额加权风险", "version": "v2.3", "kind": "metric", "status": "frozen", "detail": "按合同约定窗口及金额权重计算；演示数据仅用于交互验证。"},
    {"id": "avg-credit", "name": "户均授信金额", "version": "v1.4", "kind": "metric", "status": "frozen", "detail": "总策略授信金额 / 有效客户数量；单位万元。"},
    {"id": "release-gate", "name": "授信模型准出标准", "version": "v1", "kind": "gate", "status": "active", "detail": "约束违反率 <= 1%；模拟风险 <= 3.5%；覆盖率 >= 95%。仅用于 Demo。"},
    {"id": "data-snapshot", "name": "样本数据切分契约", "version": "v2", "kind": "dataset", "status": "frozen", "detail": "基于时间切分；训练、验证、锁定测试集互斥；禁止未来信息泄漏。"},
]
SKILLS = [
    {"id": "odps-query", "name": "ODPS Query", "stage": "Data", "summary": "SQL 参数化查询、时间窗口验证和数据血缘（演示接口）"},
    {"id": "dataset-build", "name": "Dataset Builder", "stage": "Data", "summary": "生成样本清单、校验 Schema、记录快照"},
    {"id": "reward-tune", "name": "Reward Tuning", "stage": "Training", "summary": "Reward 配置版本化及对照实验"},
    {"id": "evaluate-credit", "name": "Credit Evaluator", "stage": "Evaluation", "summary": "统一 Metric Registry + Val 与冻结 Test 评估"},
    {"id": "badcase-analysis", "name": "Badcase Analyzer", "stage": "Evaluation", "summary": "分类、回归测试与实验引用"},
]
KNOWLEDGE = [
    {"id": "k1", "title": "Reward 组内差异不足", "category": "Reward design", "source": "EXP-003", "detail": "当候选额度过度集中时，组内 advantage 可能很弱；需检查分布再得出结论。"},
    {"id": "k2", "title": "严格隔离锁定测试集", "category": "Evaluation", "source": "credit-policy/v3", "detail": "Val 可用于模型选择；锁定 Test 不用于反复调参。"},
    {"id": "k3", "title": "策略授信基准必须可追溯", "category": "Data contract", "source": "credit-policy/v3", "detail": "计算时使用 total_credit_amt 并校验数据血缘。"},
]
BADCASES = [
    {"type": "约束违反", "count": 8, "severity": "high", "note": "高风险画像触发异常提额，需校验边界规则"},
    {"type": "额度异常", "count": 13, "severity": "medium", "note": "模型给出超过推荐区间的额度"},
    {"type": "决策方向", "count": 19, "severity": "medium", "note": "降额与提额动作方向不一致"},
    {"type": "数据质量", "count": 6, "severity": "low", "note": "部分历史字段缺失，输入降级"},
]

def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

@contextmanager
def session():
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()

def seed():
    with session() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS experiments (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, reward TEXT NOT NULL,
            lr REAL NOT NULL, dataset TEXT NOT NULL, checkpoint TEXT NOT NULL,
            status TEXT NOT NULL, created_at TEXT NOT NULL,
            val_risk REAL, test_risk REAL, avg_credit REAL, coverage REAL,
            violations REAL, gate TEXT NOT NULL, notes TEXT NOT NULL
        )""")
        if db.execute("SELECT COUNT(*) FROM experiments").fetchone()[0]:
            return
        examples = [
            ("EXP-001", "GRPO Baseline", "reward-v1", 0.000001, "credit-v12", "ckpt175", "completed", 3.42, 3.48, 35.8, 98.1, 0.9, "PASS", "初始对照版本"),
            ("EXP-002", "Smooth Reward", "reward-v2", 0.000001, "credit-v12", "ckpt200", "completed", 3.18, 3.24, 36.1, 98.8, 0.6, "PASS", "更平滑的奖励信号"),
            ("EXP-003", "Aggressive Margin", "reward-v3", 0.0000007, "credit-v12", "ckpt220", "completed", 3.71, 3.83, 37.2, 97.6, 1.5, "FAIL", "风险超过模拟准出阈值"),
            ("EXP-004", "Conservative Risk", "reward-v4", 0.0000008, "credit-v13", "ckpt240", "completed", 2.96, 3.03, 34.9, 99.1, 0.3, "PASS", "保守风险约束"),
        ]
        for i, e in enumerate(examples):
            db.execute("""INSERT INTO experiments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                       (*e[:6], e[6], f"2026-11-0{5+i}T10:00:00Z", *e[7:]))
seed()

class NewExperiment(BaseModel):
    name: str = Field(min_length=3, max_length=100)
    reward: str = Field(min_length=2, max_length=80)
    lr: float = Field(gt=0, le=0.1)
    dataset: str = "credit-v13"
    notes: str = Field(default="", max_length=500)

def experiment_rows():
    with session() as db:
        return [dict(row) for row in db.execute("SELECT * FROM experiments ORDER BY created_at DESC")]

@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "synthetic-demo"}

@app.get("/api/overview")
def overview():
    rows = experiment_rows()
    return {
        "experiments": len(rows),
        "passed": sum(r["gate"] == "PASS" for r in rows),
        "failed": sum(r["gate"] == "FAIL" for r in rows),
        "datasets": len(set(r["dataset"] for r in rows)),
        "best_risk": min((r["test_risk"] for r in rows if r["test_risk"] is not None), default=None),
        "recent": rows[:4],
        "pipeline": ["Requirements", "Data", "Build", "Process", "Train", "Val", "Test", "Gate", "Knowledge"]
    }

@app.get("/api/experiments")
def experiments():
    return experiment_rows()

@app.post("/api/experiments", status_code=201)
def create_experiment(payload: NewExperiment):
    eid = "EXP-" + uuid4().hex[:8].upper()
    now = datetime.now(timezone.utc).isoformat()
    with session() as db:
        db.execute("""INSERT INTO experiments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                   (eid, payload.name, payload.reward, payload.lr, payload.dataset, "pending", "draft", now,
                    None, None, None, None, None, "NOT_RUN", payload.notes))
    return {"id": eid, "status": "draft", "next_step": "evaluate"}

def get_experiment(eid):
    with session() as db:
        row = db.execute("SELECT * FROM experiments WHERE id = ?", (eid,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return dict(row)

@app.get("/api/experiments/{eid}")
def experiment_detail(eid: str):
    return get_experiment(eid)

@app.post("/api/experiments/{eid}/evaluate")
def evaluate(eid: str):
    row = get_experiment(eid)
    if row["status"] != "draft":
        raise HTTPException(status_code=409, detail="Only draft experiments can be evaluated")
    # Deterministic synthetic evaluation. Not a real model training operation.
    s = sum(ord(c) for c in (row["reward"] + row["dataset"])) % 100
    val_risk = round(2.85 + s / 150, 2)
    test_risk = round(val_risk + .07, 2)
    avg_credit = round(34.2 + s / 50, 2)
    coverage = round(96 + (s % 30) / 10, 2)
    violations = round(.2 + (s % 17) / 10, 2)
    gate = "PASS" if test_risk <= 3.5 and coverage >= 95 and violations <= 1 else "FAIL"
    with session() as db:
        db.execute("""UPDATE experiments SET status='completed', checkpoint='synthetic-ckpt',
            val_risk=?, test_risk=?, avg_credit=?, coverage=?, violations=?, gate=?
            WHERE id=?""", (val_risk, test_risk, avg_credit, coverage, violations, gate, eid))
    return get_experiment(eid)

@app.get("/api/contracts")
def contracts():
    return CONTRACTS

@app.get("/api/skills")
def skills():
    return SKILLS

@app.get("/api/knowledge")
def knowledge():
    return KNOWLEDGE

@app.get("/api/badcases")
def badcases():
    return BADCASES

@app.get("/api/lineage/{eid}")
def lineage(eid: str):
    e = get_experiment(eid)
    return {"experiment_id": eid, "nodes": [
        {"id": e["dataset"], "kind": "dataset", "label": e["dataset"]},
        {"id": "credit-policy/v3", "kind": "contract", "label": "Credit Policy v3"},
        {"id": eid, "kind": "experiment", "label": e["name"]},
        {"id": e["checkpoint"], "kind": "model", "label": e["checkpoint"]},
        {"id": "eval-" + eid, "kind": "evaluation", "label": "Val + Holdout Test"},
        {"id": "gate-" + eid, "kind": "gate", "label": e["gate"]},
    ], "edges": [
        [e["dataset"], eid], ["credit-policy/v3", eid], [eid, e["checkpoint"]],
        [e["checkpoint"], "eval-" + eid], ["eval-" + eid, "gate-" + eid]
    ]}


# A separate router implements the task-oriented, synthetic credit research wizard.
from .workflow import router as credit_workflow_router
app.include_router(credit_workflow_router)
