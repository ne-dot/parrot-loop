# Loop Engineer

把用户 Bug 反馈变成可审计的 **signal / task**，并由 AI agent loop 辅助修复、验证与回访草稿。

```text
【手动】SYNC NOW / CLI sync
  → sync → feedback → task
  → high：系统 approved → coding → verify → followup
  → low/medium：Gate 人工批准 → 同上
  →【人工】合入 / 发信 / 上游结案
```

**每个 loop 都是 AI agent**（读 `domains/*/README.md` 合同 → 读写 artifacts → 写 log）。  
**唯一例外**：`sync` 是确定性 HTTP 同步，不做推理。

| Loop | Runtime | 说明 |
|---|---|---|
| feedback / task / verify / followup | **DeepSeek** | Chat + tools（读写工件；verify 可读业务仓库） |
| coding | **Cursor Agent CLI** | 改业务代码、建分支、本地 commit + 内环 Verify |
| sync | 脚本 | 无 LLM；从可配置的 Feedback API 拉数 |

合入、发信、结案一律【人工】。`priority=high` 可由系统自动 `approved_by=system`；全量 `LOOP_AUTO_APPROVE` 禁止默认开启。

## 快速开始

```bash
git clone <this-repo> && cd loop-engineer
cp .env.example .env
# 最少：DEEPSEEK_API_KEY
# sync 另需：LOOP_API_BASE_URL + LOOP_ADMIN_COOKIE（或跳过 sync，手写 feedback md）
# coding 另需：CURSOR_API_KEY 或本机 `agent login`，以及 LOOP_WORKSPACE_ROOT / LOOP_DEFAULT_REPOS
npm install && npm link

docker compose up -d          # Redis（默认宿主机 :6380）
loop-engineer serve           # :4010 Control Plane API
# 另开终端
loop-engineer workers         # 六个 loop worker
npm run console:dev           # :4011 Mission Console
```

手动触发一轮：Console **SYNC NOW**，或：

```bash
curl -X POST http://127.0.0.1:4010/api/loop/sync
```

## 配置反馈数据源（解耦上游）

`sync` **不绑定**任何具体产品。通过 `.env` 指向你的反馈列表 API：

| 变量 | 默认 | 说明 |
|---|---|---|
| `LOOP_API_BASE_URL` | `http://localhost:4001` | API 基址 |
| `LOOP_FEEDBACK_LIST_PATH` | `/api/admin/feedback` | 列表 path |
| `LOOP_FEEDBACK_TYPE` | `bug` | `type` 查询参数 |
| `LOOP_FEEDBACK_STATUSES` | `open,in_progress` | `status` 列表 |
| `LOOP_FEEDBACK_SOURCE` | `site_feedback` | 写入工件的 `source` 字段 |
| `LOOP_ADMIN_COOKIE_NAME` | `auth_token` | Cookie 名（文档/提示用） |
| `LOOP_ADMIN_COOKIE` | （空） | 整串 `name=value` |

期望 JSON 形状（camelCase）：

```json
{
  "ok": true,
  "feedback": [
    {
      "id": "uuid",
      "userId": "…",
      "type": "bug",
      "content": "…",
      "contact": null,
      "status": "open",
      "createdAt": "…",
      "updatedAt": "…",
      "userEmail": null
    }
  ],
  "page": 1,
  "pageSize": 100,
  "total": 1
}
```

**不接 HTTP 时**：把反馈写成 `artifacts/feedback/feedback-{id}.md`（见下方模板），直接跑 `feedback` / `task`。

```markdown
---
id: demo-001
type: bug
status: open
source: manual
user_id: null
user_email: null
contact: null
loop_status: pending
signal_id: null
created_at: "2026-01-01T00:00:00.000Z"
updated_at: "2026-01-01T00:00:00.000Z"
synced_at: "2026-01-01T00:00:00.000Z"
---

## Content

按钮点了没反应。
```

## 业务仓库（coding / verify）

| 变量 | 默认 | 说明 |
|---|---|---|
| `LOOP_WORKSPACE_ROOT` | 上一级目录 | 各业务仓库的父目录 |
| `LOOP_DEFAULT_REPOS` | `.` | `task.repos` 为空时的 fallback（逗号分隔） |
| `LOOP_DEFAULT_BRANCH` | `main` | verifier `git diff` 基准分支 |
| `LOOP_FOLLOWUP_SIGN_OFF` | `—— Loop Engineer` | 回访草稿落款 |

Coding 会在 `LOOP_WORKSPACE_ROOT/<repo>` 下建分支 `loop/{task-id}`，只本地 commit，**不** push / merge。

## CLI

```bash
# 逐步（不经队列）
loop-engineer sync
loop-engineer feedback
loop-engineer task
loop-engineer run-to-task
loop-engineer coding --task <id>
loop-engineer verify --task <id>
loop-engineer followup --task <id>

# 事件驱动
loop-engineer serve
loop-engineer worker --loop sync|feedback|task|coding|verify|followup
loop-engineer workers
loop-engineer console   # 别名 web / ui
```

## 批准 task（门禁）

### Web（推荐）

Mission Console → **Gate**：Approve / Reject（仅非 high）。**Trace** 查看完整工件链（不展示 Cursor diff）。

### 手改 md

1. 打开 `artifacts/tasks/task-*.md`
2. `status: proposed` → `approved`，填 `approved_at`
3. `loop-engineer coding --task <id>`（或等 `task.approved` 事件）

## 硬边界

- 禁止自动合入 `main` / 自动部署 / 自动发信
- 禁止 loop 自动把上游反馈标为 `resolved`
- 禁止默认开启全量 `LOOP_AUTO_APPROVE`
- 允许：`priority=high` → `approved_by=system` + `task.approved`

## 目录结构

```text
loop-engineer/
├── artifacts/          # 文件即状态（Markdown 工件）
│   ├── feedback/       # 含用户原文 → gitignore
│   ├── signals/        # 可提交（审计）
│   ├── tasks/
│   ├── verifications/
│   └── followups/      # 含联系方式 → gitignore
├── domains/            # Agent 合同（必含 ## Verify）
├── console/            # Mission Console（Vite + React）
├── scripts/            # CLI / workers / API
├── state/              # 运行态（gitignore）
├── docker-compose.yml  # 自有 Redis
└── .env.example
```

## Domain 合同

| Domain | 文件 |
|---|---|
| sync | `domains/sync/README.md` |
| feedback | `domains/feedback/README.md` |
| product (task) | `domains/product/README.md` |
| coding | `domains/coding/README.md` |
| verifier | `domains/verifier/README.md` |
| followup | `domains/followup/README.md` |
| 模板 | `domains/CONTRACT_TEMPLATE.md` |

## 安全与隐私

- **不要提交** `.env`、`artifacts/feedback/**`、`artifacts/followups/**`（已 gitignore）
- `log.md` 为本地审计日志，默认 gitignore
- 生产环境建议设置 `LOOP_API_TOKEN`
- Cookie / API Key 只放本机 `.env`

## License

[MIT](./LICENSE)
