"""Integration tests for the six-stage synthetic research workflow."""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
BASE = "/api/workflow"


def new_run(sample_size=100, seed=16):
    response = client.post(BASE + "/runs", json={
        "name": "完整授信研发流程测试",
        "table": "demo_credit_feature_di",
        "partition": "20261031",
        "sql": "SELECT user_id, risk_grade FROM demo_credit_research.demo_credit_feature_di WHERE ds='20261031' LIMIT 100",
        "sample_size": sample_size,
        "seed": seed
    })
    assert response.status_code == 201, response.text
    return response.json()


def test_sources_are_mock_only():
    response = client.get(BASE + "/sources")
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "mock-only"
    assert data["label_fields"] == ["fpd7", "fpd30", "tpd30", "c_m1", "c_d30"]


def test_end_to_end_workflow_and_no_label_leakage():
    sampled = new_run()
    run_id = sampled["id"]
    assert sampled["stage"] == "sampled"
    assert sampled["row_count"] == 100
    assert sampled["sql_executed"] is False
    assert sampled["raw_preview"][0]["features"]["total_credit_amt"] > 0
    assert "labels" not in sampled["raw_preview"][0]
    assert client.post(f"{BASE}/runs/{run_id}/train", json={}).status_code == 409

    enriched = client.post(f"{BASE}/runs/{run_id}/labels")
    assert enriched.status_code == 200
    assert enriched.json()["stage"] == "labeled"
    for label in ("fpd7", "fpd30", "tpd30", "c_m1", "c_d30"):
        assert label in enriched.json()["label_preview"][0]["labels"]

    dialogues = client.post(f"{BASE}/runs/{run_id}/dialogues")
    assert dialogues.status_code == 200
    payload = dialogues.json()
    assert payload["query_count"] == 100
    query = payload["query_preview"][0]
    assert [msg["role"] for msg in query["messages"]] == ["user"]
    assert "answer" not in query
    assert "labels" not in query
    for label in ("fpd7", "fpd30", "tpd30", "c_m1", "c_d30"):
        assert label not in query["messages"][0]["content"]
    assert "total_credit_amt" in query["messages"][0]["content"]

    split = client.post(f"{BASE}/runs/{run_id}/split", json={
        "test_ratio": .2, "val_ratio": .1, "seed": 42
    })
    assert split.status_code == 200
    assert split.json()["split"] == {"train": 70, "val": 10, "test": 20}

    trained = client.post(f"{BASE}/runs/{run_id}/train", json={
        "epochs": 4, "learning_rate": .000001,
        "reward_weight": .65, "reward_version": "risk-aware-v2"
    })
    assert trained.status_code == 200
    assert trained.json()["training"]["real_model_trained"] is False
    assert len(trained.json()["training"]["history"]) == 4
    # Tune a second candidate on the same frozen data split, using Val only.
    tuned = client.post(f"{BASE}/runs/{run_id}/train", json={
        "epochs": 3, "learning_rate": .0000008,
        "reward_weight": .25, "reward_version": "risk-aware-v3"
    })
    assert tuned.status_code == 200
    assert len(tuned.json()["candidates"]) == 2
    assert tuned.json()["training"]["candidate_id"] in ("C01", "C02")

    finished = client.post(f"{BASE}/runs/{run_id}/report")
    assert finished.status_code == 200
    report = finished.json()["report"]
    assert report["status"] == "DEMO_ONLY"
    assert report["model_trained"] is False
    assert len(report["tuning_history"]) == 2
    assert report["selected_candidate"] in ("C01", "C02")
    assert report["dataset"]["test_set_locked"] is True
    assert report["dataset"]["train"] + report["dataset"]["val"] + report["dataset"]["test"] == 100
    assert [row["label"] for row in report["metrics"]] == [
        "fpd7", "fpd30", "tpd30", "c_m1", "c_d30"
    ]
    assert all(row["positive_rate"] >= 0 for row in report["metrics"])
    assert all(c["passed"] for c in report["checks"][:4])
    assert report["checks"][-1]["passed"] is False
    assert client.post(f"{BASE}/runs/{run_id}/report").status_code == 409
    assert client.post(f"{BASE}/runs/{run_id}/train", json={}).status_code == 409
    assert client.get(f"{BASE}/runs/{run_id}").json()["stage"] == "reported"
    assert any(row["id"] == run_id for row in client.get(BASE + "/runs").json())


def test_invalid_sql_and_unsupported_partition():
    bad = {
        "table": "demo_credit_feature_di", "partition": "20261031",
        "sql": "DROP TABLE demo_credit_feature_di WHERE ds='20261031'",
        "sample_size": 100
    }
    assert client.post(BASE + "/runs", json=bad).status_code == 422
    bad["sql"] = "SELECT * FROM demo_credit_research.demo_credit_feature_di WHERE ds='20261031'"
    bad["partition"] = "19990101"
    assert client.post(BASE + "/runs", json=bad).status_code == 422


def test_split_and_training_input_validation():
    run = new_run(50, 20)
    run_id = run["id"]
    client.post(f"{BASE}/runs/{run_id}/labels")
    client.post(f"{BASE}/runs/{run_id}/dialogues")
    invalid = client.post(f"{BASE}/runs/{run_id}/split", json={
        "test_ratio": .4, "val_ratio": .4, "seed": 42
    })
    assert invalid.status_code == 422
    valid = client.post(f"{BASE}/runs/{run_id}/split", json={
        "test_ratio": .2, "val_ratio": .1, "seed": 42
    })
    assert valid.status_code == 200
    bad_train = client.post(f"{BASE}/runs/{run_id}/train", json={"epochs": 0})
    assert bad_train.status_code == 422
