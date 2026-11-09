import os
from pathlib import Path
import tempfile

tmp = tempfile.TemporaryDirectory()
os.environ["MLH_DB_PATH"] = str(Path(tmp.name) / "test.sqlite")

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_and_seed():
    assert client.get("/api/health").json()["mode"] == "synthetic-demo"
    overview = client.get("/api/overview").json()
    assert overview["experiments"] == 4
    assert overview["passed"] == 3

def test_contracts_and_badcases():
    contracts = client.get("/api/contracts").json()
    assert any(c["id"] == "risk-3m30d" for c in contracts)
    assert len(client.get("/api/badcases").json()) == 4

def test_create_evaluate_and_lineage():
    response = client.post("/api/experiments", json={
        "name": "Reward verification", "reward": "reward-v9", "lr": 0.000001
    })
    assert response.status_code == 201
    eid = response.json()["id"]
    result = client.post(f"/api/experiments/{eid}/evaluate")
    assert result.status_code == 200
    assert result.json()["gate"] in ("PASS", "FAIL")
    assert result.json()["test_risk"] is not None
    assert len(client.get(f"/api/lineage/{eid}").json()["nodes"]) == 6
    assert client.post(f"/api/experiments/{eid}/evaluate").status_code == 409

def test_bad_input_and_missing_experiment():
    assert client.post("/api/experiments", json={"name": "x", "reward": "r", "lr": -1}).status_code == 422
    assert client.get("/api/experiments/no-such-id").status_code == 404
