# AI Model Development Hub — 授信模型研发流程 Demo

一个**按真实研发顺序操作的六步向导**，而不是抽象的模型管理后台。前端 React + Vite，后端 FastAPI + SQLite。

> **重要：完全使用合成数据。** ODPS 项目与表、标签接口、客户画像、模型训练轨迹、AUC、Reward 和测试报告都是 Mock，不会执行真实 ODPS SQL、连接生产标签服务、训练 GPU 模型或执行真实授信决策。可用作未来接入系统的交互原型。

## 操作流程

| 步骤 | 你在页面上执行的动作 | 产物 |
| --- | --- | --- |
| 1. ODPS 数据采样 | 选择 ODPS 表和 ds 分区，编写 SQL，设置采样量和随机种子，点击模拟采样 | SQL Spec + 原始特征快照 |
| 2. 获取特征与 Y 标 | 模拟调用风险标签服务，按 sample_id 关联原始特征与标签 | Feature Dataset + Label Sidecar |
| 3. Query 生成 | 将特征加工为对话提示词，仅生成 user/query | Query-only JSONL 逻辑数据 |
| 4. 数据划分 | 设置 Train / Val / Test 比例和随机种子 | 互斥样本 ID 清单（冻结 Test） |
| 5. 训练调优 | 设置 Reward 版本、权重、学习率、Epoch；反复生成候选并仅根据 Val 选择 | 模拟训练曲线 + Val 候选对照 |
| 6. 测试报告 | 在锁定 Test 集一次性生成指标、Badcase、质量检查及 JSON 报告 | Synthetic Test Report |

### Y 标字段

演示中分开存储 fpd7、fpd30、tpd30、c_m1、c_d30 五个二元结果。实际计算窗口、成熟样本、分母、观察期等口径**必须由生产数据契约另行定义**。演示只是随机合成标签，不能解释为真实逾期指标。

### Query-only 不是 SFT 标注数据

每条输出示例：

    {
      "sample_id": "mock_42_00001",
      "messages": [
        {"role": "user", "content": "你是授信额度决策助手。请根据以下客户画像..."}
      ]
    }

不包含 assistant、answer 或任何 Y 标。此类数据是 **RL rollout / online generation 的提示词输入**，并不包含训练 SFT 必需的监督答案。真实 RL 仍需要推理 rollout、Reward 计算和训练调度；当前训练页只是模拟这些产物的展示。

### Val / Test 的边界

- Train：训练输入；Val：多个 Reward/超参候选之间的选择依据。
- Test：独立冻结集；只在“生成测试报告”时访问，不用于训练期间反复调优。
- 调参最多允许六轮候选，保留每轮模拟配置、Val FPD30 AUC 和候选引用。
- 测试报告记录五个 Y 标的**合成正样本率**和**手工评分函数 AUC**，并标记 model_trained=false / DEMO_ONLY，绝不代表真实模型的效果。

## 本地运行

先安装 Python 3.10+、Node.js 20+。

终端 1 — API：

    cd backend
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    uvicorn app.main:app --reload --port 8000

终端 2 — 前端：

    cd frontend
    npm install
    npm run dev

打开 **http://localhost:5173**；FastAPI 文档在 **http://localhost:8000/docs**。

已有的通用实验注册 Demo API 仍保留在 /api/experiments 下，新流程 API 统一在 /api/workflow 下。backend/hub.sqlite 自动创建；删除它可重置本地演示数据。

## 自动测试

    cd backend && python -m pytest -q
    cd frontend && npm run build

GitHub Actions 在 PR 和 push 时执行后端集成测试与 Vite 生产构建。backend/tests/test_workflow.py 覆盖完整状态转换、五个 Y 标、query-only、锁定 Test、Val 重复调参和错误输入。

## API 概览

- GET /api/workflow/sources：模拟 ODPS 表、分区和标签服务定义
- POST /api/workflow/runs：保存 SQL 并生成合成特征快照
- POST /api/workflow/runs/{id}/labels：模拟接口取得 Y 标并关联
- POST /api/workflow/runs/{id}/dialogues：将特征转换为 query-only
- POST /api/workflow/runs/{id}/split：冻结 Train/Val/Test
- POST /api/workflow/runs/{id}/train：模拟训练候选，可多次调用、只用 Val 比较
- POST /api/workflow/runs/{id}/report：一次性生成锁定 Test 测试报告
- GET /api/workflow/runs / GET /api/workflow/runs/{id}：查看历史流程和产物

状态机：sampled → labeled → dialogues → split → trained → reported。不能跳步，报告一旦生成不能重新进行 Test 评估或继续调参。

## 代码结构

    frontend/src/App.tsx            六步研发向导和交互
    frontend/src/workflow.css       页面样式
    backend/app/workflow.py         模拟数据/标签/转换/切分/训练/评估 API
    backend/tests/test_workflow.py  流程集成测试
    foundation/contracts/           数据和业务契约
    foundation/skills/              Codex Skills
    foundation/recipes/             研发 Recipe
    AGENTS.md                       Agent 项目约束

## 下一版应该接入什么

1. **ODPS Adapter**：列出有权限的表、分区，对 SQL 做 dry run / 成本检查后提交异步查询并保存快照 ID。
2. **Label Service Adapter**：明确 sample_id 关联键、观察窗口、标签成熟度和结果分区；Y 与 prompt 物理隔离。
3. **Dataset Builder**：将 query-only 保存为真正的 JSONL / ODPS 数据集，记录 prompt 模板版本与不可变切分清单。
4. **Training Adapter**：接真实 RL 平台，支持 checkpoint、日志、Reward 设计、训练状态回调。
5. **Evaluation Adapter**：按冻结指标契约执行 Val/holdout 指标、样本分群、Badcase 及准出门禁。
6. **Artifact Registry**：模型、数据、SQL、训练参数、指标结果通过 run ID 串成可回溯血缘。

不要把此 Demo 的随机标签生成器、模拟评分器或准出阈值直接复用到生产。
