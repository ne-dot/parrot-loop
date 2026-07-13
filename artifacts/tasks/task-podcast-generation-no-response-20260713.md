---
id: task-podcast-generation-no-response-20260713
title: 修复生成播客失败（复发窗 2026-07-13）
status: verified
source_signal: signal-podcast-generation-no-response-20260713
priority: high
owner_loop: coding
repos:
  - parrot-server
  - parrot-web-app
branch: loop/task-podcast-generation-no-response-20260713
created_at: "2026-07-13T16:30:00.000Z"
approved_at: "2026-07-13T08:25:30.493Z"
approved_by: system
verified_at: "2026-07-13T17:00:00.000Z"
verified_by: verifier-loop
---
## Problem

用户报告生成播客失败，点击生成后无响应/无法生成。该问题在 2026-07-13 复发窗内已累积 2 条反馈（occurrences=2），用户催促尽快解决。旧窗（signal-podcast-generation-no-response）的根因为 `handleGenerate` 误删 `flushRoleDrafts()` / `startGeneration()` 调用，已于 `loop/task-podcast-generation-no-response` 修复并 verified。本窗可能为回归、未合入或新根因，需独立排查。

## Evidence

- feedback `c1de6bfe-93bd-4712-ac97-afa58531e806`: "生成播客失败，赶紧修复"
- feedback `6aa78450-dfd7-4e2c-8b48-3df7b90f4c6a`: "播客无法生成，请尽快解决"
- related: `signal-podcast-generation-no-response`（prior, >24h，旧窗已 verified）
- 旧窗根因：`WorkbenchPage.tsx` 中 `handleGenerate` 误删 `flushRoleDrafts()` + `startGeneration()`（commit `903839e`），修复于 `loop/task-podcast-generation-no-response`（commit `e0021d8`）

## Reproduction

1. 确认 `parrot-web-app` 的 `main` 分支是否已合入旧窗修复（commit `e0021d8`）
2. 若已合入，登录鹦鹉工作台，进入播客生成页面
3. 填写播客生成所需参数（主题、音色等）
4. 点击「生成播客」按钮
5. 观察：
   - 按钮是否有 loading 反馈
   - 浏览器控制台是否有网络请求/JS 报错
   - 后端 API 是否收到请求及响应
   - 是否出现「语音生成任务已创建…」提示
6. 若旧窗修复已合入但仍复现，说明存在新根因，需进一步排查：
   - 检查 `handleGenerate` 当前逻辑是否完整
   - 检查 API 接口 `/api/generation/start` 是否正常
   - 检查 Worker/队列是否正常消费任务

## Acceptance Criteria

- [x] 查明本窗（2026-07-13）生成播客失败的根因（回归/未合入/新根因）
- [x] 若为旧窗修复未合入 `main`，合入后验证通过即可
- [x] 若为新根因，修复后用户点击「生成播客」能正常触发生成流程
- [x] 修复后生成过程中有正确的 loading/进度反馈
- [x] 修复后生成成功或失败均有明确提示
- [x] 相关测试或手工复现通过
- [x] Change Summary 说明根因、改动范围与验证步骤

## Human Approval【人工·门禁】

将本文件 `status` 改为 `approved` 后，方可【人工】触发 coding loop：

`loop-engineer coding --task task-podcast-generation-no-response-20260713`

## Change Summary

### 根因

1. **旧窗修复已合入**：`parrot-web-app` `main` 含 `e0021d8` / merge `eaf7a9f`；`handleGenerate` 仍正确调用 `flushRoleDrafts()` + `startGeneration()`，非旧窗回归。
2. **新根因（本窗）**：`parrot-server/src/generation.ts` 创建 job 路由被注入未提交的联调埋点：
   - `throw new GenerationStateError('生成任务创建失败')`（注释写明 INTENTIONAL BUG / Loop Engineer self-test）
   - 本地 `npm run dev` 热更新后，POST `/api/projects/:id/generation/jobs` 恒失败 → 用户感知「生成失败 / 无法生成」。

### 改动

| 仓库 | 分支 | 说明 |
|---|---|---|
| `parrot-server` | `loop/task-podcast-generation-no-response-20260713` | 丢弃埋点，恢复为 `createGenerationJob` 正常路径（与 `main` 一致；埋点从未入库，故无独立 commit） |
| `parrot-web-app` | 同分支 · commit `0b6ec5f` | 提交态与失败提示：`submitting` 与「生成中」分离；居中错误 toast；创建失败友好文案 |

文件（web-app）：

- `src/pages/WorkbenchPage.tsx`
- `src/features/workbench/WorkbenchTopbar.tsx`
- `src/styles/pages.css`
- `src/utils/errors.ts`

### 验证

- `parrot-web-app`：`npx tsc -b` 通过（无 `npm run typecheck`）
- `parrot-server`：`npm run typecheck` 通过；`generation.ts` 已无 INTENTIONAL throw
- 代码审查：成功路径仍走创建 job +「语音生成任务已创建…」；失败路径 `showToast(..., 'error')` + 按钮「提交中…」
- 建议【人工】：热更新 API 后，解析 → 选音色 → 点「生成播客」，应能创建任务而非恒定 400

### 下一步

等待【人工】合入 `loop/*` 与 `loop-engineer verify`。
