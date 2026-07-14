/**
 * coding 内环 Verify：按 repos 跑约定检查命令。
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { getEnv, PATHS } from './env.js'
import { listMarkdownFiles, readMarkdownFile, writeMarkdownFile } from './md.js'
import type { TaskFrontmatter } from './types.js'

export type CodingVerifyResult = {
  ok: boolean
  summary: string
  outputs: Array<{ repo: string; command: string; exitCode: number; output: string }>
}

function resolveCheckCommand(repoPath: string): string {
  const pkgPath = path.join(repoPath, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        scripts?: Record<string, string>
      }
      if (pkg.scripts?.typecheck) return 'npm run typecheck'
    } catch {
      /* fall through */
    }
  }
  return 'npx tsc -b --pretty false'
}

function truncate(s: string, max = 4000): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}\n…(truncated ${s.length - max} chars)`
}

export function runCodingVerify(task: TaskFrontmatter): CodingVerifyResult {
  const env = getEnv()
  const repos = task.repos?.length > 0 ? task.repos : env.defaultRepos
  const outputs: CodingVerifyResult['outputs'] = []

  for (const repo of repos) {
    const repoPath = path.resolve(env.workspaceRoot, repo)
    if (!existsSync(repoPath)) {
      outputs.push({
        repo,
        command: '(missing)',
        exitCode: 1,
        output: `仓库目录不存在: ${repoPath}`,
      })
      continue
    }
    const command = resolveCheckCommand(repoPath)
    const result = spawnSync(command, {
      cwd: repoPath,
      shell: true,
      encoding: 'utf8',
      timeout: 180_000,
      env: process.env,
    })
    const exitCode = result.status ?? 1
    const output = truncate(
      `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() || `(exit ${exitCode})`,
    )
    outputs.push({ repo, command, exitCode, output })
  }

  const failed = outputs.filter((o) => o.exitCode !== 0)
  if (failed.length) {
    const summary = failed
      .map((o) => `${o.repo}: \`${o.command}\` exit ${o.exitCode}`)
      .join('；')
    return { ok: false, summary: `coding Verify 失败：${summary}`, outputs }
  }
  return {
    ok: true,
    summary: `coding Verify ok：${outputs.map((o) => `${o.repo}(\`${o.command}\`)`).join(', ')}`,
    outputs,
  }
}

export function loadTask(taskId: string): {
  path: string
  data: TaskFrontmatter
  body: string
} | null {
  for (const f of listMarkdownFiles(PATHS.tasks)) {
    const { data, body } = readMarkdownFile<TaskFrontmatter>(f)
    if (data.id === taskId || path.basename(f).includes(taskId)) {
      return { path: f, data, body }
    }
  }
  return null
}

export function markTaskStatus(
  taskPath: string,
  status: TaskFrontmatter['status'],
): void {
  const { data, body } = readMarkdownFile<TaskFrontmatter>(taskPath)
  writeMarkdownFile(taskPath, { ...data, status } as unknown as Record<string, unknown>, body)
}

export function codingVerifyMaxAttempts(): number {
  const n = Number(process.env.LOOP_CODING_VERIFY_MAX_ATTEMPTS ?? 3)
  return Number.isFinite(n) && n > 0 ? n : 3
}

export function formatCodingVerifyFeedback(r: CodingVerifyResult): string {
  const blocks = r.outputs.map(
    (o) =>
      `### ${o.repo}\ncommand: ${o.command}\nexit: ${o.exitCode}\n\`\`\`\n${o.output}\n\`\`\``,
  )
  return `${r.summary}\n\n${blocks.join('\n\n')}`
}
