# Loop Engineer（鹦鹉工厂）

把 SiteKit 用户 Bug 反馈变成可审计的 signal / task，并由 **AI agent loop** 辅助修复、验证与回访草稿。

```text
【手动】SYNC NOW / CLI sync
  → sync-worker → feedback-worker → task-worker
  → high：系统 approved → coding-worker → verify → followup
  → low/medium：Gate 人工批准 → 同上
  →【人工】合入 / 发信 / Admin 结案
```

**每个 loop 都是 AI agent**（读 `domains/*/README.md` 合同 → 读写 artifacts → 写 log）。  
**唯一例外**：`sync` 是确定性 HTTP 同步，不做推理。

每个合同含必填 **`## Verify`**（见 `domains/CONTRACT_TEMPLATE.md`）。运行时：coding 改码后强制跑检查（失败回 Agent，预算 `LOOP_CODING_VERIFY_MAX_ATTEMPTS`）；其余 loop 结束前做确定性自检。独立 **verifier loop** 仍保留（maker-checker）。

| Loop | Runtime | 说明 |
|---|---|---|
| feedback / task / verify / followup | **DeepSeek** | Chat + tools（读写工件；verify 可读业务仓库） |
| coding | **Cursor Agent CLI** | 改业务代码、建分支、本地 commit + 内环 Verify |
| sync | 脚本 | 无 LLM |

合入、发信、结案一律【人工】。`priority=high` 可由系统自动 `approved_by=system`；全量 `LOOP_AUTO_APPROVE` 禁止默认开启。

Mission Console：**Trace** 页可只读查看 feedback → signal → 阈值/task → 批准 → coding 状态 → DeepSeek×AC → 回访草稿（**不**展示 Cursor diff）。

## 快速开始

```bash
cd loop-engineer
cp .env.example .env
# 必填：LOOP_ADMIN_COOKIE + DEEPSEEK_API_KEY
# coding 另需：CURSOR_API_KEY 或本机 agent login
npm install && npm link

# 2.2.2 事件总线（loop 自有 Redis，端口 6380）
docker compose up -d
loop-engineer serve          # :4010 API（已 build 时可直接打开托管的 Console）
# 另开终端
loop-engineer workers        # 六个 loop worker
npm run console:dev          # :4011 独立 Mission Console（开发，对齐设计稿）
# 等价：loop-engineer console  /  loop-engineer web
```

Mission Console：**独立前端** `loop-engineer/console`（不嵌 Admin）。开发 `:4011`；`npm run console:build` 后由 `serve` 托管。

## CLI

```bash
# 逐步（不经队列，仍可用）
loop-engineer sync
loop-engineer feedback
loop-engineer task
loop-engineer run-to-task
loop-engineer coding --task …
loop-engineer verify --task …
loop-engineer followup --task …

# 事件驱动（2.2.2）
loop-engineer serve
loop-engineer worker --loop sync|feedback|task|coding|verify|followup
loop-engineer workers
loop-engineer console          # 别名 web / ui → :4011
```

手动触发一轮：`curl -X POST http://127.0.0.1:4010/api/loop/sync` 或 Web **SYNC NOW**。  
本版**无**默认定时 sync（`LOOP_SCHEDULER_INTERVAL_MS=0`）。

## 【人工·门禁】如何批准 task

### Web（推荐）

Mission Console → **Gate**：Approve / Reject（仅非 high）。**Trace** 查看完整工件链。

### 手改 md

1. 打开 `artifacts/tasks/task-*.md`
2. 把 `status: proposed` 改为 `status: approved`，填 `approved_at`
3. 再触发：`loop-engineer coding --task <task-id>`  
   或在事件模式下由 `task.approved` 事件唤起 coding-worker。

## 硬边界

- 禁止自动合入 `main` / 自动部署 / 自动发信
- 禁止 loop 自动把 Admin 反馈标为 `resolved`
- 禁止默认开启全量 `LOOP_AUTO_APPROVE`
- 允许：`priority=high` → `approved_by=system` + `task.approved`

## 实现进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 2.2.1 | CLI 闭环 P0 | **完成** |
| 2.2.2-1 | 事件总线 + serve 只读 | **完成** |
| 2.2.2-2 | 六 loop worker + 手动 SYNC | **完成** |
| 2.2.2-3 | 门禁分层 + 修复链 | **完成** |
| 2.2.2-4 | Mission Console（Admin `/loop`） | **完成** |
| 2.2.2-5 | 鉴权 / 文档 | **完成** |
