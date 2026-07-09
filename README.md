# Loop Engineer（鹦鹉工厂）

把 SiteKit 用户 Bug 反馈变成可审计的 signal / task，并由 **AI agent loop** 辅助修复、验证与回访草稿。

```text
【人工】sync（确定性拉 API）
  →【人工】feedback agent → signals
  →【人工】task agent → proposed task
  →【人工】批准 →【人工】coding agent
  →【人工】verifier agent → followup agent（草稿）
  →【人工】合入 / 发信 / Admin 结案
```

**每个 loop 都是 AI agent**（读 `domains/*/README.md` 合同 → 读写 artifacts → 写 log）。  
**唯一例外**：`sync` 是确定性 HTTP 同步，不做推理。

| Loop | Runtime | 说明 |
|---|---|---|
| feedback / task / verify / followup | **DeepSeek** | Chat + tools（读写工件；verify 可读业务仓库） |
| coding | **Cursor Agent CLI** | 改业务代码、建分支、本地 commit |
| sync | 脚本 | 无 LLM |

合入、发信、结案、批准开工一律【人工】。

## 快速开始

```bash
cd loop-engineer
cp .env.example .env
# 必填：LOOP_ADMIN_COOKIE + DEEPSEEK_API_KEY
# coding 另需：CURSOR_API_KEY 或本机 agent login
npm install && npm link
loop-engineer --help
```

## CLI

```bash
loop-engineer sync                 # 脚本：拉 Admin bug → artifacts/feedback
loop-engineer feedback             # agent：归类 → signals
loop-engineer task                 # agent：出 proposed task（未达阈值则跳过）
loop-engineer run-to-task          # sync → feedback → task
loop-engineer coding --task …      # agent：须已 approved
loop-engineer verify --task …
loop-engineer followup --task …
loop-engineer task --dry-prompt    # 只打印将发给 agent 的 prompt
```

## 【人工·门禁】如何批准 task

1. 打开 `artifacts/tasks/task-*.md`
2. 确认 Problem / Reproduction / Acceptance Criteria 合理
3. 把 frontmatter 里的：

```yaml
status: proposed
approved_at: null
```

改为：

```yaml
status: approved
approved_at: "2026-07-10T12:00:00.000Z"   # 填实际时间
```

4. 再触发：`loop-engineer coding --task <task-id>`  
   未改 `approved` 时 coding **拒绝启动**（exit ≠ 0）。

## 推荐命令流

```bash
loop-engineer run-to-task
# 【人工】按上一节批准 task
loop-engineer coding --task task-xxx
loop-engineer verify --task task-xxx
loop-engineer followup --task task-xxx
# 【人工】合入 loop/*；发信；Admin resolved
```

## 【人工】结案手顺（followup 之后）

1. 打开 `artifacts/followups/*.md`，确认是 `status: draft`
2. **人工**复制发送（邮件 / 微信等）；脚本**永不**自动发信
3. 在 Admin 将对应反馈标为 `resolved`
4. Review `loop/*` 分支 diff，【人工】合入主分支（需要时再 push）
5. 可选：在 `log.md` 手记「已发送 / 已结案」

## Task 阈值（product 合同）

满足任一即可出 task：`occurrences >= 2` **或** `priority: high` **或** `ready_for_task: true`。  
未达阈值时 `loop-engineer task` 直接跳过，不调用 agent。

## 硬边界

- 禁止自动合入 `main` / 自动部署 / 自动发信 / 自动批准开工
- 禁止 loop 自动把 Admin 反馈标为 `resolved`

## 实现进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | 骨架 + Loop Contract + CLI | **完成** |
| 2 | sync（脚本）+ feedback（agent） | **完成** |
| 3 | task agent + `run-to-task` + 批准手顺 | **完成** |
| 4 | coding + verifier agent + 文案演练 | **完成** |
| 5 | followup agent + P0 验收 | **完成** |
