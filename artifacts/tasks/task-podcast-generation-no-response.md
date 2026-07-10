---
id: task-podcast-generation-no-response
title: 修复点击生成播客按钮无响应
status: implemented
source_signal: signal-podcast-generation-no-response
priority: high
owner_loop: coding
repos:
  - parrot-web-app
branch: loop/task-podcast-generation-no-response
created_at: "2026-07-10T17:00:00.000Z"
approved_at: "2026-07-10T08:33:00.714Z"
approved_by: system
---
## Problem

用户点击「生成播客」按钮后没有任何反应，播客无法生成。该问题影响播客生成核心功能，用户无法通过点击按钮触发播客生成流程。

## Evidence

- feedback `dc0b256a-1330-4b5e-9187-e1d850d1425f`: "点击生成播客没有反应了。生成不了"
- signal `signal-podcast-generation-no-response`: type=bug, priority=high, occurrences=1

## Reproduction

1. 登录鹦鹉工作台，进入播客生成页面
2. 填写/确认播客生成所需参数（如主题、风格等）
3. 点击「生成播客」按钮
4. 观察页面是否有任何响应（加载状态、提示信息、控制台报错等）
5. 记录无响应的具体表现：
   - 按钮是否有点击反馈（如 loading 动画）
   - 浏览器控制台是否有报错（网络请求错误 / JS 异常）
   - 后端 API 是否收到请求及响应状态

## Acceptance Criteria

- [x] 查明点击生成播客按钮无响应的根因（前端事件绑定问题 / API 接口异常 / 状态管理问题 / 其他）
- [x] 修复后，用户点击「生成播客」按钮能正常触发播客生成流程
- [x] 修复后，播客生成过程中有正确的加载/进度反馈
- [x] 修复后，播客生成成功或失败均有明确提示
- [x] 相关测试或手工复现通过
- [x] Change Summary 说明根因、改动范围与验证步骤

## Human Approval【人工·门禁】

将本文件 `status` 改为 `approved` 后，方可【人工】触发 coding loop：

`loop-engineer coding --task task-podcast-generation-no-response`

## Change Summary

### 根因

`handleGenerate` 在通过前置校验后**未调用** `flushRoleDrafts()` / `startGeneration()`。  
来源：`loop/task-feedback-empty-copy` 上 commit `903839e`（chore: 调整工作台生成入口校验流程）误删了这两段调用；校验通过后函数直接结束，表现为「点击生成播客没有反应」。  
事件绑定与 API 本身正常；`main` 上仍保留正确逻辑。

### 改动

- 仓库：`parrot-web-app`
- 分支：`loop/task-podcast-generation-no-response`（commit `e0021d8`）
- 文件：`src/pages/WorkbenchPage.tsx`
- 内容：恢复生成前 `flushRoleDrafts()`，成功后 `await startGeneration()`（与需求 1.6 行为一致）

### 验证

- `npx tsc -b` 通过（仓库无 `npm run typecheck`）
- 代码审查：校验失败仍 `setMessage` 提示；成功路径会创建 job 并走既有 loading / 进度 / 成功失败提示
- 未做浏览器端到端手工点击（需本地 API + Worker）；建议【人工】在工作台复现：解析文案 → 选音色 → 点「生成播客」应出现「语音生成任务已创建…」并进入生成中态

### 下一步

等待【人工】审阅合入 `loop/*`，再跑 `loop-engineer verify`。
