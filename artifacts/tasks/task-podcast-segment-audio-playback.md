---
id: task-podcast-segment-audio-playback
title: 修复播客分段音频无法播放/报错
status: verified
source_signal: signal-podcast-segment-audio-playback
priority: high
owner_loop: coding
repos: [parrot-server]
branch: loop/task-podcast-segment-audio-playback
created_at: "2026-07-10T02:05:00.000Z"
approved_at: null
verified_at: "2026-07-10T02:30:00.000Z"
---

## Problem

用户生成播客分段音频后无法播放，播放时出现报错。该问题影响播客生成功能的可用性，属于核心功能故障。

## Evidence

- feedback `37101b9e-7c17-4ac5-b460-21ea83cbda35`: "现在生成播客的分段音频无法播放，会报错"
- signal `signal-podcast-segment-audio-playback`: type=bug, priority=high, occurrences=1

## Reproduction

1. 登录鹦鹉工作台，进入播客生成功能
2. 生成一段播客内容，等待分段音频生成完成
3. 点击播放已生成的分段音频
4. 观察是否出现报错（前端报错提示 / 控制台错误 / 后端返回错误）
5. 记录报错的具体错误信息（错误码、错误消息、堆栈等）

## Acceptance Criteria

- [x] 查明播客分段音频无法播放的根因（前端播放器问题 / 后端音频文件生成问题 / 存储或接口问题）
- [x] 修复后，用户可正常播放已生成的播客分段音频，无报错
- [x] 修复后，新生成的播客分段音频也可正常播放
- [x] 相关测试或手工复现通过
- [x] Change Summary 说明根因、改动范围与验证步骤

## Change Summary

**根因**：`parrot-server/src/generationService.ts` 中 `toAudioSegment()` 将 `audioUrl` 误写为硬编码占位值 `"123"`（工作区脏改动），API 返回错误 URL；前端 `fetchAuthenticatedBlob(audioUrl)` 请求 `http://host/123` 导致 404/报错，分段试听失败。`main` 分支已含正确实现 `audioUrl: row.audio_url`，本次恢复该映射并补充回归测试防再犯。

**改动范围**（`parrot-server`，分支 `loop/task-podcast-segment-audio-playback`）：
- 恢复 `toAudioSegment` 的 `audioUrl: row.audio_url` 映射（与 `main` 一致）
- 新增 `src/generationService.test.ts`：断言 `audio_url` 正确映射为 `audioUrl`

**验证**：
- `npm run typecheck` 通过
- `npm test -- src/generationService.test.ts` 通过（20/20）
- 手工：生成播客分段 → 队列/生成详情点击试听 → 应请求 `/api/generation/files/{projectId}/{jobId}/NNN.mp3` 并正常播放

## Human Approval【人工·门禁】

将本文件 `status` 改为 `approved` 后，方可【人工】触发 coding loop：

`loop-engineer coding --task task-podcast-segment-audio-playback`
