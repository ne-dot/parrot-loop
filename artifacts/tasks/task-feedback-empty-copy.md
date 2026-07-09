---
id: task-feedback-empty-copy
title: 修正反馈历史空状态文案
status: verified
source_signal: signal-abc
priority: low
owner_loop: coding
repos:
  - parrot-web-app
branch: loop/task-feedback-empty-copy
created_at: "2026-07-09T16:50:00.000Z"
approved_at: "2026-07-09T16:50:00.000Z"
---

## Problem

设置页「意见反馈 → 反馈历史」空状态文案为「暂无反馈记录。可先提交一条反馈。」语气略生硬，且未引导用户返回提交表单。阶段 4 低风险演练：只改这一处文案。

## Evidence

- 代码：`parrot-web-app/src/pages/SettingsPage.tsx` 中 `settings-empty` 文案
- 本 task 为 Loop Engineer 阶段 4 演练用（非真实用户重复反馈阈值产物）

## Reproduction

1. 登录工作台，打开设置 → 意见反馈 → 反馈历史
2. 在无历史记录时看到空状态文案

## Acceptance Criteria

- [x] 空状态文案改为：「还没有反馈记录，返回上一页提交一条吧。」
- [x] 仅修改该文案字符串，不改布局/逻辑
- [x] 在 `parrot-web-app` 仓库使用分支 `loop/task-feedback-empty-copy`
- [x] task 含 Change Summary；**不** merge 到 main

## Human Approval【人工·门禁】

本文件已为演练预置 `status: approved`。触发：

`loop-engineer coding --task task-feedback-empty-copy`

## Change Summary

**改了什么**
- `parrot-web-app/src/pages/SettingsPage.tsx`：反馈历史空状态文案由「暂无反馈记录。可先提交一条反馈。」改为「还没有反馈记录，返回上一页提交一条吧。」

**为什么**
- 原语气略生硬，且未引导用户返回提交表单；新文案更口语化并明确引导返回上一页提交。

**如何验证**
1. `cd parrot-web-app && npm run dev`
2. 登录 → 设置 → 意见反馈 → 反馈历史（无历史记录账号）
3. 确认空状态显示新文案
4. `npx tsc -b` 通过（仓库无 `typecheck` script）
