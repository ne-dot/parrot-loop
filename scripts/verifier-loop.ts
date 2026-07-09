/**
 * Verifier Loop — DeepSeek agent 写验证报告（可读业务仓库 diff）。
 * 【人工】loop-engineer verify --task <id> [--dry-prompt]
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runLoopAgent } from './lib/agent.js'
import { getEnv, PATHS } from './lib/env.js'
import { appendLog } from './lib/log.js'
import { listMarkdownFiles, readMarkdownFile } from './lib/md.js'
import type { TaskFrontmatter } from './lib/types.js'

function parseTaskId(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--task') return argv[i + 1] ?? null
  }
  return null
}

function findTaskFile(taskId: string): string | null {
  const files = listMarkdownFiles(PATHS.tasks)
  for (const f of files) {
    const { data } = readMarkdownFile<TaskFrontmatter>(f)
    if (data.id === taskId || path.basename(f).includes(taskId)) return f
  }
  return null
}

export async function runVerifierLoop(argv = process.argv.slice(2)): Promise<number> {
  const taskId = parseTaskId(argv)
  if (!taskId) {
    console.error('用法: loop-engineer verify --task <task-id>')
    return 1
  }

  const hit = findTaskFile(taskId)
  if (!hit) {
    console.error(`找不到 task: ${taskId}`)
    appendLog({ loop: 'verifier-loop', status: 'failed', summary: `task not found: ${taskId}` })
    return 1
  }

  const { data } = readMarkdownFile<TaskFrontmatter>(hit)
  const env = getEnv()
  const prompt = `
你是鹦鹉工厂 Loop Engineer 的 Verifier Loop Agent（DeepSeek）。

## 必须遵守
先用 read_file 阅读：loop-engineer/domains/verifier/README.md
（绝对路径：${path.join(PATHS.domains, 'verifier', 'README.md')}）

## 本轮任务
1. 读取 task：${hit}（当前 status=${data.status}）
2. 对照 Acceptance Criteria 与 Change Summary，用 run_shell 检查相关子仓库分支 loop/${taskId} 的 diff
   （例如：git -C parrot-web-app log / git -C parrot-web-app diff main...HEAD）。
3. 写入验证报告：loop-engineer/artifacts/verifications/verify-${taskId}.md
   - frontmatter：id, task, status(passed|failed|needs_human), created_at
   - 正文：## Checks / ## Commands Run / ## Notes
4. 若 passed，可将 task status 更新为 verified。
5. 追加 loop-engineer/log.md。
6. 调用 done(summary)。

## 工作区
本 agent workspace = ${env.workspaceRoot}（含各业务子仓库与 loop-engineer/）

## 硬边界
禁止 merge main、禁止发信、禁止自动 Admin resolved。
failed 时不要建议「已修复」回访。
`.trim()

  return runLoopAgent({
    loop: 'verifier-loop',
    prompt,
    // 需读业务子仓库 diff，故 workspace 为工作区根
    workspace: env.workspaceRoot,
    runtime: 'deepseek',
  })
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) runVerifierLoop().then((code) => process.exit(code))
