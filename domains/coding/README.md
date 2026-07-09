# Coding Loop Contract

> Domain：`coding`  
> 执行器：**AI agent**（Cursor `agent` CLI）  
> 启动：【人工】`loop-engineer coding --task <id>`（须已 `approved`）  
> Prompt 模板：`scripts/coding-loop.md`

## 你是谁

你是 **Coding Loop Agent**。你在**已批准**的 task 上做最小修复。

## 目标

在独立分支 `loop/{task-id}` 修复问题，对齐 Acceptance Criteria，写 Change Summary；**不**合入 main、**不**部署、**不**发信。

## 输入（必须先读）

1. 本合同：`domains/coding/README.md`
2. Prompt 模板要点：`scripts/coding-loop.md`
3. 指定的 `artifacts/tasks/task-*.md`（必须 `status: approved`）
4. 关联 signal / feedback
5. 相关子仓库代码（`LOOP_WORKSPACE_ROOT`）

## 输出

| 产物 | 说明 |
|---|---|
| Git 分支 | `loop/{task-id}`（落在相关子仓库，如 `parrot-web-app`） |
| 代码 diff | 最小改动 |
| Task | `in_progress` → `implemented`；`branch` / `repos`；`## Change Summary` |
| `log.md` | 追加 |

## 工作步骤

1. 再次确认 task `status === approved`；否则立即停止。
2. `cd` 到相关子仓库 → `git checkout -b loop/{task-id}`（已存在则 checkout）。
3. 最小复现 / 定位 → 最小修复 → 能跑则跑检查。
4. **仅提交本 task 相关文件**到当前 `loop/{task-id}` 分支（`git add` 指定路径 + `git commit`）。**不要**把无关脏文件一并提交；**不要** `git push`；**不要** merge 到 main。
5. 更新 task 与 log。
6. **停止**：等待【人工】合入与 `loop-engineer verify`。

## 能做什么

- 在独立分支修改与 task 相关的代码
- 在该分支上做**本地 commit**（不含 push）
- 更新 task 工件与 log

## 不能做什么

- **不能**在未 `approved` 时开工
- **不能** merge / push 到 main（也**不要** `git push` 远程，除非【人工】明确要求）
- **不能**部署、发信、改 Admin `resolved`
- **不能**扩大范围做无关重构
- **不能**修改 `.env` 中的密钥
- **不能**把工作区里无关改动混进本 task 的 commit

## 停止条件

- 未批准 → 立即停
- 最小修复完成或明确无法完成 → 停并记原因（可标 `failed`）

## 失败时怎么记录

task 可标 `failed`；log 写原因；**不要**假装 `implemented`。
