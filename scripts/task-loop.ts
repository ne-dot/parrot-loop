/**
 * Task Loop — DeepSeek agent 根据达阈值 signal 生成 proposed task。
 * 【人工】loop-engineer task [--dry-prompt]
 * CLI 预扫描阈值：无合格 signal 时不启动 agent。
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runLoopAgent } from './lib/agent.js'
import { PATHS } from './lib/env.js'
import { appendLog } from './lib/log.js'
import { listEligibleSignals } from './lib/signals.js'
import { assertTaskLoop, formatAssertFailure } from './lib/verify-artifacts.js'

export async function runTaskLoop(): Promise<number> {
  const { eligible, skipped } = listEligibleSignals()

  if (eligible.length === 0) {
    const summary = `无达阈值 signal，不出 task（跳过 ${skipped.length} 个）`
    console.log(`loop-engineer task: ${summary}`)
    for (const s of skipped) {
      console.log(`  - ${s.id}: ${s.reason}`)
    }
    appendLog({
      loop: 'task-loop',
      status: 'skipped',
      summary,
      details: skipped.map((s) => `${s.id}: ${s.reason}`),
    })
    return 0
  }

  console.log(`loop-engineer task: ${eligible.length} 个 signal 达阈值，启动 agent…`)
  for (const e of eligible) {
    console.log(`  - ${e.id}（${e.reason}）`)
  }

  const eligibleBlock = eligible
    .map((e) => `- ${e.id} — ${e.title}（原因: ${e.reason}；文件: ${e.path}）`)
    .join('\n')

  const prompt = `
你是鹦鹉工厂 Loop Engineer 的 Task Loop Agent（product domain）。

## 必须遵守
先用 read_file 完整阅读并遵守：
${path.join(PATHS.domains, 'product', 'README.md')}

## 本轮必须处理的 signal（CLI 已预筛，达阈值）
${eligibleBlock}

## 本轮任务
1. 为上面每一个 signal 生成一份 artifacts/tasks/task-{slug}.md。
2. frontmatter 必须含：id, title, status: proposed, source_signal, priority, owner_loop: coding, repos: [], branch: null, created_at, approved_at: null。
3. 正文必须含：## Problem / ## Evidence / ## Reproduction / ## Acceptance Criteria / ## Human Approval【人工·门禁】。
4. Human Approval 小节写明：将本文件 status 改为 approved 后，方可【人工】触发 coding。
5. 更新对应 signal：task_id、status → task_created、updated_at；Timeline 追加一行。
6. 追加 log.md（列出新建了哪些 task）。
7. 调用 done(summary)。

## 硬边界
- status 只能是 proposed，禁止写成 approved
- 禁止改业务代码；禁止 coding / 发信 / 部署 / 改 Admin 状态
- 不要为未列出的 signal 硬造 task
- 禁止 reopen 旧 signal / 覆盖旧 task；跨窗同类问题由 feedback 新建 signal，本轮只为列出的新 signal 出 task
`.trim()

  const code = await runLoopAgent({
    loop: 'task-loop',
    prompt,
    workspace: PATHS.root,
    runtime: 'deepseek',
  })
  if (code !== 0) return code

  const check = assertTaskLoop(eligible.map((e) => e.id))
  if (!check.ok) {
    const summary = formatAssertFailure(check)
    console.error(`loop-engineer task Verify: ${summary}`)
    appendLog({ loop: 'task-loop', status: 'failed', summary })
    return 1
  }
  console.log(`loop-engineer task Verify: ${check.summary}`)
  return 0
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) runTaskLoop().then((code) => process.exit(code))
