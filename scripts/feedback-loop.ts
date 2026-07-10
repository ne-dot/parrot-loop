/**
 * Feedback Loop — DeepSeek agent 归类与写 signal（默认可改）。
 * 【人工】触发：loop-engineer feedback [--dry-prompt]
 */
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runLoopAgent } from './lib/agent.js'
import { PATHS } from './lib/env.js'
import { appendLog } from './lib/log.js'
import { listMarkdownFiles, readMarkdownFile } from './lib/md.js'
import type { FeedbackFrontmatter } from './lib/types.js'
import {
  assertFeedbackLoop,
  formatAssertFailure,
  listPendingBugIds,
} from './lib/verify-artifacts.js'

function countPending(): number {
  if (!existsSync(PATHS.feedback)) return 0
  return listMarkdownFiles(PATHS.feedback).filter((file) => {
    const { data } = readMarkdownFile<FeedbackFrontmatter>(file)
    return (
      data.type === 'bug' &&
      data.loop_status === 'pending' &&
      (data.status === 'open' || data.status === 'in_progress')
    )
  }).length
}

function listSignalIds(): string[] {
  if (!existsSync(PATHS.signals)) return []
  return readdirSync(PATHS.signals)
    .filter((n) => n.endsWith('.md'))
    .sort()
}

export async function runFeedbackLoop(): Promise<number> {
  const pending = countPending()
  if (pending === 0) {
    const msg = '无 pending bug 反馈。请先 loop-engineer sync'
    console.log(`loop-engineer feedback: ${msg}`)
    appendLog({ loop: 'feedback-loop', status: 'skipped', summary: msg })
    return 0
  }

  const pendingIds = listPendingBugIds()
  const signals = listSignalIds()
  const prompt = `
你是鹦鹉工厂 Loop Engineer 的 Feedback Loop Agent。

## 必须遵守的合同
先用 read_file 完整阅读并遵守：
${path.join(PATHS.domains, 'feedback', 'README.md')}

## 本轮任务
1. 处理 artifacts/feedback/ 下所有 loop_status=pending 且 type=bug 的反馈（当前约 ${pending} 条）。
2. 对照已有 signals（当前文件：${signals.length ? signals.join(', ') : '无'}）。
3. 语义相同的 Bug 合并进同一 signal；不同则新建。
4. 回写每条 feedback 的 loop_status 与 signal_id。
5. 追加 log.md。
6. 调用 done(summary)。

## 硬边界（再次强调）
- 只改 loop-engineer/artifacts 与 log.md
- 禁止改任何业务子仓库代码
- 禁止发信、禁止改 Admin DB 状态、禁止创建 task

完成后用简短中文说明：新建了几个 signal、合并了几条、跳过了几条。
`.trim()

  const code = await runLoopAgent({
    loop: 'feedback-loop',
    prompt,
    workspace: PATHS.root,
    runtime: 'deepseek',
  })
  if (code !== 0) return code

  const check = assertFeedbackLoop(pendingIds)
  if (!check.ok) {
    const summary = formatAssertFailure(check)
    console.error(`loop-engineer feedback Verify: ${summary}`)
    appendLog({ loop: 'feedback-loop', status: 'failed', summary })
    return 1
  }
  console.log(`loop-engineer feedback Verify: ${check.summary}`)
  return 0
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  runFeedbackLoop().then((code) => process.exit(code))
}
