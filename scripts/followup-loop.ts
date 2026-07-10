/**
 * Followup Loop — DeepSeek agent 只写回访草稿。
 * 【人工】loop-engineer followup --task <id> [--dry-prompt]
 *
 * CLI 门禁：task 必须存在；若 verification 为 failed，仍可启动 agent，
 * 但 prompt 明确禁止「已修复」话术（合同硬边界）。
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runLoopAgent } from './lib/agent.js'
import { PATHS } from './lib/env.js'
import { appendLog } from './lib/log.js'
import { listMarkdownFiles, readMarkdownFile } from './lib/md.js'
import type { FeedbackFrontmatter, TaskFrontmatter } from './lib/types.js'
import { assertFollowupLoop, formatAssertFailure } from './lib/verify-artifacts.js'

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

function readVerificationStatus(taskId: string): {
  path: string | null
  status: string | null
} {
  const candidates = [
    path.join(PATHS.verifications, `verify-${taskId}.md`),
    path.join(PATHS.verifications, `verify-task-${taskId.replace(/^task-/, '')}.md`),
  ]
  // also scan
  for (const f of listMarkdownFiles(PATHS.verifications)) {
    if (f.includes(taskId)) candidates.unshift(f)
  }
  for (const p of candidates) {
    if (!existsSync(p)) continue
    const { data } = readMarkdownFile<Record<string, unknown>>(p)
    return { path: p, status: String(data.status ?? null) }
  }
  return { path: null, status: null }
}

function listRelatedFeedback(signalId: string | null): Array<{
  id: string
  email: string | null
  contact: string | null
  path: string
}> {
  if (!signalId) return []
  const out: Array<{ id: string; email: string | null; contact: string | null; path: string }> = []
  for (const f of listMarkdownFiles(PATHS.feedback)) {
    const { data } = readMarkdownFile<FeedbackFrontmatter>(f)
    if (data.signal_id === signalId) {
      out.push({
        id: data.id,
        email: data.user_email,
        contact: data.contact,
        path: f,
      })
    }
  }
  return out
}

export async function runFollowupLoop(argv = process.argv.slice(2)): Promise<number> {
  const taskId = parseTaskId(argv)
  if (!taskId) {
    console.error('用法: loop-engineer followup --task <task-id>')
    return 1
  }

  const hit = findTaskFile(taskId)
  if (!hit) {
    console.error(`找不到 task: ${taskId}`)
    appendLog({ loop: 'followup-loop', status: 'failed', summary: `task not found: ${taskId}` })
    return 1
  }

  const { data: task } = readMarkdownFile<TaskFrontmatter>(hit)
  const verify = readVerificationStatus(taskId)
  const related = listRelatedFeedback(task.source_signal)

  if (verify.status === 'failed') {
    console.log(
      `loop-engineer followup: verification=${verify.status} → 允许写「仍在跟进」草稿，禁止「已修复」话术`,
    )
  } else if (verify.status === 'passed') {
    console.log(`loop-engineer followup: verification=passed → 可写处理完成类草稿`)
  } else {
    console.log(`loop-engineer followup: 无 verification 或 status=${verify.status}`)
  }

  const relatedBlock =
    related.length === 0
      ? '（未找到关联 feedback；可根据 task Evidence 自行定位 artifacts/feedback/）'
      : related
          .map(
            (r) =>
              `- ${r.id} @ ${r.path}（email=${r.email ?? 'null'}, contact=${r.contact ?? 'null'}）`,
          )
          .join('\n')

  const prompt = `
你是鹦鹉工厂 Loop Engineer 的 Followup Loop Agent（DeepSeek）。

## 必须遵守
先用 read_file 完整阅读：${path.join(PATHS.domains, 'followup', 'README.md')}

## 本轮上下文
- Task 文件：${hit}（status=${task.status}）
- Verification：${verify.path ?? '无'}（status=${verify.status ?? '无'}）
- 关联 feedback：
${relatedBlock}

## 本轮任务
1. 按合同门禁为关联 feedback 写入 artifacts/followups/followup-{feedback_id}.md（status: draft）。
2. verification 为 passed：可写已处理说明 + 如何验证；无 email/contact 时写 Admin 备注向结案文案，recipient: null。
3. verification 为 failed / 缺失：禁止「已修复」话术；可写「仍在跟进」或跳过并记 log。
4. 追加 ${PATHS.log}，明确「待人工发送」与结案手顺提醒。
5. 调用 done(summary)。

## 硬边界
禁止自动发信；禁止标 sent；禁止改代码 / 合入 / Admin PATCH。
`.trim()

  const code = await runLoopAgent({
    loop: 'followup-loop',
    prompt,
    workspace: PATHS.root,
    runtime: 'deepseek',
  })
  if (code !== 0) return code

  const check = assertFollowupLoop(taskId, verify.status)
  if (!check.ok) {
    const summary = formatAssertFailure(check)
    console.error(`loop-engineer followup Verify: ${summary}`)
    appendLog({ loop: 'followup-loop', status: 'failed', summary })
    return 1
  }
  console.log(`loop-engineer followup Verify: ${check.summary}`)
  return 0
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) runFollowupLoop().then((code) => process.exit(code))
