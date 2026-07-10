/**
 * 确定性自检（合同 Verify 的机器侧）。
 * LLM 自评不能作为唯一通过条件。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PATHS } from './env.js'
import { listMarkdownFiles, readMarkdownFile } from './md.js'
import type {
  FeedbackFrontmatter,
  SignalFrontmatter,
  TaskFrontmatter,
} from './types.js'

export type AssertResult = { ok: boolean; summary: string; details?: string[] }

const SIGNAL_REQUIRED = [
  'id',
  'title',
  'type',
  'status',
  'priority',
  'occurrences',
  'sources',
] as const

/** sync 落盘后：本地 feedback 文件数应 ≥ 本轮写入意图（由调用方传入计数） */
export function assertSyncResult(opts: {
  fetched: number
  written: number
  updated: number
}): AssertResult {
  const details: string[] = []
  if (opts.fetched < 0) {
    return { ok: false, summary: 'sync 拉取计数异常', details: [`fetched=${opts.fetched}`] }
  }
  const files = listMarkdownFiles(PATHS.feedback).length
  if (opts.fetched > 0 && files === 0) {
    return {
      ok: false,
      summary: 'sync 声称拉取成功但 artifacts/feedback 为空',
      details: [`fetched=${opts.fetched}`],
    }
  }
  if (opts.written + opts.updated === 0 && opts.fetched > 0) {
    details.push('拉取>0 但未新建/更新任何文件（可能已是最新）')
  }
  return {
    ok: true,
    summary: `sync ok：fetched=${opts.fetched} written=${opts.written} updated=${opts.updated} files=${files}`,
    details,
  }
}

/**
 * feedback-loop 结束后：原先 pending 的 bug 应达终态；
 * processed 须有 signal_id；关联 signal 字段齐全。
 */
export function assertFeedbackLoop(pendingBefore: string[]): AssertResult {
  const details: string[] = []
  const stillPending: string[] = []

  for (const id of pendingBefore) {
    const file = path.join(PATHS.feedback, `feedback-${id}.md`)
    if (!existsSync(file)) {
      details.push(`缺失文件 feedback-${id}.md`)
      continue
    }
    const { data } = readMarkdownFile<FeedbackFrontmatter>(file)
    if (data.loop_status === 'pending') {
      stillPending.push(id)
      continue
    }
    if (data.loop_status === 'processed') {
      if (!data.signal_id) {
        details.push(`${id}: processed 但缺少 signal_id`)
      } else {
        const sigFile = path.join(PATHS.signals, `${data.signal_id}.md`)
        const alt = listMarkdownFiles(PATHS.signals).find((f) => f.includes(data.signal_id!))
        const hit = existsSync(sigFile) ? sigFile : alt
        if (!hit) {
          details.push(`${id}: signal_id=${data.signal_id} 文件不存在`)
        } else {
          const { data: sig } = readMarkdownFile<SignalFrontmatter>(hit)
          for (const key of SIGNAL_REQUIRED) {
            if (sig[key] === undefined || sig[key] === null) {
              details.push(`${data.signal_id}: 缺字段 ${key}`)
            }
          }
        }
      }
    }
  }

  if (stillPending.length) {
    return {
      ok: false,
      summary: `feedback Verify 失败：仍有 ${stillPending.length} 条 pending`,
      details: [...stillPending.map((id) => `pending: ${id}`), ...details],
    }
  }
  if (details.length) {
    return { ok: false, summary: 'feedback Verify 失败：工件不完整', details }
  }
  return {
    ok: true,
    summary: `feedback Verify ok（检查 ${pendingBefore.length} 条）`,
  }
}

export function listPendingBugIds(): string[] {
  if (!existsSync(PATHS.feedback)) return []
  return listMarkdownFiles(PATHS.feedback)
    .map((f) => {
      const { data } = readMarkdownFile<FeedbackFrontmatter>(f)
      return data
    })
    .filter(
      (d) =>
        d.type === 'bug' &&
        d.loop_status === 'pending' &&
        (d.status === 'open' || d.status === 'in_progress'),
    )
    .map((d) => d.id)
}

/** task-loop：针对本轮 eligible signal 检查对应 task */
export function assertTaskLoop(eligibleSignalIds: string[]): AssertResult {
  if (eligibleSignalIds.length === 0) {
    return { ok: true, summary: 'task Verify skipped（无合格 signal）' }
  }
  const details: string[] = []
  const tasks = listMarkdownFiles(PATHS.tasks).map((f) => {
    const { data, body } = readMarkdownFile<TaskFrontmatter>(f)
    return { data, body, path: f }
  })

  for (const sid of eligibleSignalIds) {
    const related = tasks.filter((t) => t.data.source_signal === sid)
    const open = related.filter(
      (t) => t.data.status !== 'closed' && t.data.status !== 'failed',
    )
    if (open.length === 0) {
      details.push(`${sid}: 达阈值但无未关闭 task`)
      continue
    }
    if (open.length > 1) {
      details.push(
        `${sid}: 存在 ${open.length} 个未关闭 task（${open.map((t) => t.data.id).join(', ')}）`,
      )
    }
    for (const t of open) {
      if (t.data.status === 'approved' && !t.data.approved_at) {
        /* high 系统批可能有 approved_at；若误标 approved 无时间戳也算问题 */
      }
      // 本轮新建应为 proposed；若已是后续状态则跳过严格检查
      if (t.data.status === 'proposed') {
        if (t.data.approved_at) {
          details.push(`${t.data.id}: proposed 但 approved_at 非空`)
        }
        if (!/##\s*Acceptance Criteria/i.test(t.body)) {
          details.push(`${t.data.id}: 缺少 ## Acceptance Criteria`)
        }
        if (!/- \[[ xX]\]/.test(t.body) && !/- \[ \]/.test(t.body)) {
          details.push(`${t.data.id}: Acceptance Criteria 无可勾选项`)
        }
      }
    }
  }

  if (details.length) {
    return { ok: false, summary: 'task Verify 失败', details }
  }
  return {
    ok: true,
    summary: `task Verify ok（${eligibleSignalIds.length} 个 signal）`,
  }
}

const FIXED_PHRASE =
  /(已修复|已经修复|问题已处理|已处理完成|修复完成|已经解决)/

/** followup-loop 结束后检查本 task 相关草稿 */
export function assertFollowupLoop(taskId: string, verifyStatus: string | null): AssertResult {
  const details: string[] = []
  const files = listMarkdownFiles(PATHS.followups).filter((f) => {
    const { data } = readMarkdownFile<Record<string, unknown>>(f)
    return String(data.task ?? '') === taskId || f.includes(taskId)
  })

  // 允许跳过（无草稿）当 verify 非 passed
  if (files.length === 0) {
    if (verifyStatus === 'passed') {
      return {
        ok: false,
        summary: `followup Verify 失败：verification=passed 但无草稿`,
        details: [`task=${taskId}`],
      }
    }
    return { ok: true, summary: 'followup Verify ok（无草稿 / 已跳过）' }
  }

  for (const f of files) {
    const { data, body } = readMarkdownFile<Record<string, unknown>>(f)
    const status = String(data.status ?? '')
    if (status === 'sent') {
      details.push(`${path.basename(f)}: 禁止 status=sent`)
    }
    if (status && status !== 'draft') {
      details.push(`${path.basename(f)}: 期望 draft，实际 ${status}`)
    }
    if (!data.feedback_id) {
      details.push(`${path.basename(f)}: 缺 feedback_id`)
    }
    if (verifyStatus !== 'passed' && FIXED_PHRASE.test(body)) {
      details.push(`${path.basename(f)}: verification≠passed 却含「已修复」类话术`)
    }
  }

  if (details.length) {
    return { ok: false, summary: 'followup Verify 失败', details }
  }
  return { ok: true, summary: `followup Verify ok（${files.length} 份草稿）` }
}

/** verifier-loop：报告完整性 */
export function assertVerificationReport(taskId: string): AssertResult {
  const candidates = [
    path.join(PATHS.verifications, `verify-${taskId}.md`),
    ...listMarkdownFiles(PATHS.verifications).filter((f) => f.includes(taskId)),
  ]
  const hit = candidates.find((p) => existsSync(p))
  if (!hit) {
    return {
      ok: false,
      summary: `verifier Verify 失败：缺少报告 verify-${taskId}.md`,
    }
  }
  const raw = readFileSync(hit, 'utf8')
  const { data, body } = readMarkdownFile<Record<string, unknown>>(hit)
  const details: string[] = []
  if (!data.status) details.push('缺 frontmatter status')
  if (!/##\s*Checks/i.test(body) && !/##\s*Checks/i.test(raw)) {
    details.push('缺 ## Checks')
  }
  if (!/##\s*Commands Run/i.test(body) && !/##\s*Commands Run/i.test(raw)) {
    details.push('缺 ## Commands Run')
  }
  // 至少有一条结论词
  if (!/\b(passed|failed|skipped|needs_human)\b/i.test(body)) {
    details.push('Checks 中未见 passed/failed/skipped/needs_human')
  }
  if (details.length) {
    return {
      ok: false,
      summary: `verifier Verify 失败：报告不完整（${path.basename(hit)}）`,
      details,
    }
  }
  return {
    ok: true,
    summary: `verifier Verify ok：${path.basename(hit)} status=${data.status}`,
  }
}

export function formatAssertFailure(r: AssertResult): string {
  const lines = [r.summary, ...(r.details ?? [])]
  return lines.join('；')
}
