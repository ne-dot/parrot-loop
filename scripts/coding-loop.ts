/**
 * Coding Loop — Cursor Agent 在已批准 task 上最小修复。
 * 【人工】loop-engineer coding --task <id> [--dry-prompt]
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runLoopAgent } from './lib/agent.js'
import { getEnv, PATHS } from './lib/env.js'
import { appendLog } from './lib/log.js'
import { listMarkdownFiles, readMarkdownFile } from './lib/md.js'
import type { TaskFrontmatter } from './lib/types.js'

function parseArgs(argv: string[]) {
  let taskId: string | null = null
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--task') taskId = argv[i + 1] ?? null
  }
  return { taskId }
}

function findTaskFile(taskId: string): string | null {
  const files = listMarkdownFiles(PATHS.tasks)
  for (const f of files) {
    const { data } = readMarkdownFile<TaskFrontmatter>(f)
    if (data.id === taskId || path.basename(f).includes(taskId)) return f
  }
  return null
}

function loadTemplate(): string {
  const p = path.join(PATHS.root, 'scripts', 'coding-loop.md')
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

export async function runCodingLoop(argv = process.argv.slice(2)): Promise<number> {
  const { taskId } = parseArgs(argv)
  if (!taskId) {
    console.error('用法: loop-engineer coding --task <task-id>')
    return 1
  }

  const hit = findTaskFile(taskId)
  if (!hit) {
    console.error(`找不到 task: ${taskId}`)
    appendLog({ loop: 'coding-loop', status: 'failed', summary: `task not found: ${taskId}` })
    return 1
  }

  const { data } = readMarkdownFile<TaskFrontmatter>(hit)
  if (data.status !== 'approved') {
    const msg = `拒绝开工：task.status=${data.status}（需要 approved）【人工·门禁】`
    console.error(`loop-engineer coding: ${msg}`)
    appendLog({ loop: 'coding-loop', status: 'failed', summary: msg })
    return 1
  }

  const env = getEnv()
  const template = loadTemplate()
  const prompt = `
你是鹦鹉工厂 Loop Engineer 的 Coding Loop Agent（Cursor）。

## 必须遵守的合同与模板
1. ${path.join(PATHS.domains, 'coding', 'README.md')}
2. Prompt 模板（参考）：
---
${template.replaceAll('{{TASK_FILE}}', path.basename(hit)).replaceAll('{{TASK_ID}}', taskId).replaceAll('{{WORKSPACE_ROOT}}', env.workspaceRoot)}
---

## 本轮任务文件
${hit}

## 执行要求
1. 确认 status=approved（已由 CLI 校验）。
2. 在相关子仓库创建分支 loop/${taskId}（不要用 main）。
3. 按 Acceptance Criteria 最小修复；优先文案/纯 UI。
4. 更新该 task：implemented + branch + repos + ## Change Summary。
5. 追加 ${PATHS.log}。

## 工作区
${env.workspaceRoot}
（loop-engineer 工件在 ${PATHS.root}）

## 硬边界
禁止 merge/push main；禁止部署；禁止发信；禁止改 Admin resolved；禁止改 .env 密钥。
`.trim()

  return runLoopAgent({
    loop: 'coding-loop',
    prompt,
    workspace: env.workspaceRoot,
    runtime: 'cursor',
  })
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  runCodingLoop().then((code) => process.exit(code))
}
