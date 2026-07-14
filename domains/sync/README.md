# Sync Feedback Contract

> Domain：`sync`  
> 执行器：**确定性脚本**（非 LLM）`scripts/sync-feedback.ts`  
> Trigger：`sync.requested`（Web SYNC NOW / API / CLI `loop-engineer sync`）

## 你是谁

确定性同步工具：从配置的 Feedback HTTP API 拉取反馈，写入 `artifacts/feedback/`。

## 目标

本地 feedback 工件与上游开放中的反馈列表对齐，供 feedback-loop 消费。

## 输入

1. `LOOP_API_BASE_URL` + `LOOP_FEEDBACK_LIST_PATH` + `LOOP_ADMIN_COOKIE`
2. `GET {LOOP_FEEDBACK_LIST_PATH}?type={LOOP_FEEDBACK_TYPE}&status={LOOP_FEEDBACK_STATUSES}`

期望响应形状（camelCase）：

```json
{
  "ok": true,
  "feedback": [{ "id", "userId", "type", "content", "contact", "status", "createdAt", "updatedAt", "userEmail", ... }],
  "page": 1,
  "pageSize": 100,
  "total": 0
}
```

也可跳过 HTTP：手动写入 `artifacts/feedback/*.md` 后直接跑后续 loop。

## 输出

| 路径 | 说明 |
|---|---|
| `artifacts/feedback/feedback-{id}.md` | 新建或更新 |
| `state/sync-state.json` | 上次同步计数 |
| `log.md` | 摘要 |

## 能做什么

- 只读 Admin API；写 feedback 工件与 sync-state、log

## 不能做什么

- 调用 LLM；改业务代码；批准 task；发信；改 Admin `resolved`

## Verify（必填）

| 项 | 说明 |
|---|---|
| **通过条件** | HTTP 成功；写出/更新条数与拉取结果一致；`sync-state.json` 已写；401/403 → **失败** |
| **失败时读什么** | 状态码与错误信息（鉴权失败须提示重配 Cookie） |
| **是否允许重试** | 可【人工】重跑 SYNC；脚本本身不自动死循环 |
| **失败升级** | `sync.failed` + log `status: failed` |

## 停止条件

本轮拉取与落盘结束，或鉴权/网络失败立即停。

## 失败时怎么记录

`log.md`：`sync-feedback` + 原因；事件 `sync.failed`。
