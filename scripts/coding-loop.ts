/**
 * Coding Loop — Cursor Agent 在已批准 task 上最小修复。
 * 【人工】loop-engineer coding --task <id> [--dry-prompt]
 * V2.2.3：改码后强制跑约定检查；失败把输出回 Agent；达预算则 coding.failed。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runLoopAgent } from './lib/agent.js'
import {
  codingVerifyMaxAttempts,
  formatCodingVerifyFeedback,
  loadTask,
  markTaskStatus,
  runCodingVerify,
} from './lib/coding-verify.js'
import { getEnv, PATHS } from './lib/env.js'
import { appendLog } from './lib/log.js'

function parseArgs(argv: string[]) {
  let taskId: string | null = null
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--task') taskId = argv[i + 1] ?? null
  }
  return { taskId }
}

function loadTemplate(): string {
  const p = path.join(PATHS.root, 'scripts', 'coding-loop.md')
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

function buildPrompt(
  taskId: string,
  taskPath: string,
  template: string,
  workspaceRoot: string,
  verifyFeedback: string | null,
): string {
  const retryBlock = verifyFeedback
    ? `
## ⚠ 上一轮合同 Verify 未通过（必须先修再标 implemented）
${verifyFeedback}

请根据上述原始输出修复，然后重新跑检查。**在检查通过前禁止**将 task 标为 implemented。
`
    : ''

  return `
你是 Loop Engineer 的 Coding Loop Agent（Cursor）。

## 必须遵守的合同与模板
1. ${path.join(PATHS.domains, 'coding', 'README.md')}
2. Prompt 模板（参考）：
---
${template.replaceAll('{{TASK_FILE}}', path.basename(taskPath)).replaceAll('{{TASK_ID}}', taskId).replaceAll('{{WORKSPACE_ROOT}}', workspaceRoot)}
---
${retryBlock}
## 本轮任务文件
${taskPath}

## 执行要求
1. 确认 status=approved 或 in_progress（已由 CLI 校验）。
2. 在相关子仓库创建分支 loop/${taskId}（不要用 main）。
3. 按 Acceptance Criteria 最小修复；优先文案/纯 UI。
4. **必须**在相关仓库跑约定检查（有 typecheck 则 npm run typecheck，否则 npx tsc -b）；通过后才可标 implemented。
5. 更新该 task：implemented + branch + repos + ## Change Summary。
6. 追加 ${PATHS.log}。

## 工作区
${workspaceRoot}
（loop-engineer 工件在 ${PATHS.root}）

## 硬边界
禁止 merge/push main；禁止部署；禁止发信；禁止改 Admin resolved；禁止改 .env 密钥。
未通过检查时**禁止**标 implemented。
`.trim()
}

export async function runCodingLoop(argv = process.argv.slice(2)): Promise<number> {
  const { taskId } = parseArgs(argv)
  if (!taskId) {
    console.error('用法: loop-engineer coding --task <task-id>')
    return 1
  }

  let hit = loadTask(taskId)
  if (!hit) {
    console.error(`找不到 task: ${taskId}`)
    appendLog({ loop: 'coding-loop', status: 'failed', summary: `task not found: ${taskId}` })
    return 1
  }

  if (hit.data.status !== 'approved' && hit.data.status !== 'in_progress') {
    const msg = `拒绝开工：task.status=${hit.data.status}（需要 approved 或 in_progress）【人工·门禁】`
    console.error(`loop-engineer coding: ${msg}`)
    appendLog({ loop: 'coding-loop', status: 'failed', summary: msg })
    return 1
  }

  const env = getEnv()
  const template = loadTemplate()

  if (argv.includes('--dry-prompt')) {
    const prompt = buildPrompt(taskId, hit.path, template, env.workspaceRoot, null)
    return runLoopAgent({
      loop: 'coding-loop',
      prompt,
      workspace: env.workspaceRoot,
      runtime: 'cursor',
      dryRun: true,
    })
  }

  const maxAttempts = codingVerifyMaxAttempts()
  let verifyFeedback: string | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`loop-engineer coding: attempt ${attempt}/${maxAttempts}`)
    const prompt = buildPrompt(taskId, hit.path, template, env.workspaceRoot, verifyFeedback)
    const code = await runLoopAgent({
      loop: 'coding-loop',
      prompt,
      workspace: env.workspaceRoot,
      runtime: 'cursor',
    })
    if (code !== 0) {
      appendLog({
        loop: 'coding-loop',
        status: 'failed',
        summary: `Cursor agent exit ${code}（attempt ${attempt}）`,
      })
      return code
    }

    hit = loadTask(taskId)
    if (!hit) {
      appendLog({ loop: 'coding-loop', status: 'failed', summary: 'task disappeared after agent' })
      return 1
    }

    // Agent 可能标了 implemented 或仍 in_progress；一律跑合同 Verify
    const verify = runCodingVerify(hit.data)
    if (verify.ok) {
      if (hit.data.status !== 'implemented' && hit.data.status !== 'failed') {
        // 检查过了但未标 implemented：允许保持，由 agent 负责；若仍是 approved 则升为 implemented 过严，只记 log
        console.log(`loop-engineer coding Verify: ${verify.summary}`)
      } else {
        console.log(`loop-engineer coding Verify: ${verify.summary}`)
      }
      if (hit.data.status === 'implemented') {
        appendLog({
          loop: 'coding-loop',
          status: 'ok',
          summary: `implemented + ${verify.summary}`,
        })
        return 0
      }
      // 未标 implemented 但检查绿：视为成功（agent 可能忘了改 status）
      if (hit.data.status === 'in_progress' || hit.data.status === 'approved') {
        markTaskStatus(hit.path, 'implemented')
        appendLog({
          loop: 'coding-loop',
          status: 'ok',
          summary: `检查通过，CLI 补标 implemented；${verify.summary}`,
        })
        return 0
      }
      appendLog({ loop: 'coding-loop', status: 'ok', summary: verify.summary })
      return 0
    }

    // Verify 失败：若 agent 已标 implemented，打回 in_progress
    if (hit.data.status === 'implemented') {
      markTaskStatus(hit.path, 'in_progress')
      console.log('loop-engineer coding: 已撤销 implemented（Verify 未通过）→ in_progress')
    }

    verifyFeedback = formatCodingVerifyFeedback(verify)
    console.error(`loop-engineer coding Verify failed (attempt ${attempt}): ${verify.summary}`)
    appendLog({
      loop: 'coding-loop',
      status: 'failed',
      summary: `verify failed attempt ${attempt}/${maxAttempts}: ${verify.summary}`,
      details: verify.outputs.map((o) => `${o.repo} exit ${o.exitCode}`),
    })

    if (attempt >= maxAttempts) {
      markTaskStatus(hit.path, 'failed')
      const msg = `验证未通过达上限（${maxAttempts}）：${verify.summary}`
      console.error(`loop-engineer coding: ${msg}`)
      appendLog({ loop: 'coding-loop', status: 'failed', summary: msg })
      return 1
    }

    console.log('loop-engineer coding: 将验证输出反馈给 agent 继续…')
  }

  return 1
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  runCodingLoop().then((code) => process.exit(code))
}
