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
import { assertVerificationReport, formatAssertFailure } from './lib/verify-artifacts.js'

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

  const { data, body } = readMarkdownFile<TaskFrontmatter>(hit)
  const env = getEnv()
  const repos = (data.repos?.length ? data.repos : ['parrot-web-app']).join(', ')
  const branch = data.branch || `loop/${taskId}`
  const reportPath = path.join(PATHS.verifications, `verify-${taskId}.md`)
  const contractPath = path.join(PATHS.domains, 'verifier', 'README.md')

  // 从正文抽 Acceptance / Change Summary 前几行，减少 agent 探索
  const acceptance =
    /## Acceptance Criteria[\s\S]*?(?=\n## |\n---|\s*$)/i.exec(body)?.[0]?.trim().slice(0, 1200) ??
    '(见 task 文件)'
  const changeSummary =
    /## Change Summary[\s\S]*?(?=\n## |\n---|\s*$)/i.exec(body)?.[0]?.trim().slice(0, 800) ??
    '(见 task 文件)'

  const gitHints = (data.repos?.length ? data.repos : ['parrot-web-app'])
    .map(
      (repo) =>
        `git -C ${path.join(env.workspaceRoot, repo)} log --oneline -5 ${branch} 2>/dev/null; git -C ${path.join(env.workspaceRoot, repo)} diff main...${branch} --stat 2>/dev/null || git -C ${path.join(env.workspaceRoot, repo)} show --stat HEAD`,
    )
    .join('\n')

  const prompt = `
你是鹦鹉工厂 Loop Engineer 的 Verifier Loop Agent（DeepSeek）。

## 效率硬约束（必须遵守）
- **禁止** list_dir 工作区根或大范围扫目录（会浪费轮次）
- 只读下列已知路径；用 run_shell 只跑下面给出的 git 命令
- 写完验证报告 + 更新 task（若 passed）+ 追加 log 后，**立刻**调用 done(summary)
- 目标：≤8 轮工具调用内结束

## 合同（可选精读，勿反复读）
${contractPath}

## 本轮已知信息（已由 CLI 解析，勿再全盘搜索）
- task 文件：${hit}
- task.id=${data.id}  status=${data.status}  priority=${data.priority}
- repos: ${repos}
- branch: ${branch}
- 报告应写到：${reportPath}

### Acceptance Criteria（摘录）
${acceptance}

### Change Summary（摘录）
${changeSummary}

## 建议命令（直接 run_shell，可按需微调）
${gitHints}

## 本轮任务（按序）
1. 用 run_shell 检查分支/diff 是否存在且与 Change Summary 一致
2. write_file 写出 ${reportPath}
   - frontmatter：id: verify-${taskId}, task: ${taskId}, status: passed|failed|needs_human, created_at: ISO
   - 正文：## Checks / ## Commands Run / ## Notes
   - Checks 每条验收结论须含英文词：passed | failed | skipped | needs_human（勿只用 ✅ / [x]）
3. 若 status=passed：把 task 的 status 改为 verified，写回 ${hit}
4. 追加 ${PATHS.log} 一行摘要
5. **立即** done(summary) —— 例如「verify passed/failed for ${taskId}」

## 硬边界
禁止 merge main、禁止发信、禁止自动 Admin resolved。
failed 时不要建议「已修复」回访。
`.trim()

  const code = await runLoopAgent({
    loop: 'verifier-loop',
    prompt,
    workspace: env.workspaceRoot,
    runtime: 'deepseek',
    // verify 偶发探索浪费轮次；略提高上限 + 靠 prompt 收紧
    maxRounds: Math.max(env.deepseekMaxRounds, 20),
  })
  if (code !== 0) return code

  const check = assertVerificationReport(taskId)
  if (!check.ok) {
    const summary = formatAssertFailure(check)
    console.error(`loop-engineer verify Verify: ${summary}`)
    appendLog({ loop: 'verifier-loop', status: 'failed', summary })
    return 1
  }
  console.log(`loop-engineer verify Verify: ${check.summary}`)
  return 0
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) runVerifierLoop().then((code) => process.exit(code))
