/**
 * Trace 聚合：feedback → signal → task → coding状态 → verification → followup
 * 不包含 Cursor diff。
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { PATHS } from './env.js'
import { listMarkdownFiles, readMarkdownFile } from './md.js'
import type {
  FeedbackFrontmatter,
  SignalFrontmatter,
  TaskFrontmatter,
} from './types.js'

export type TraceStage =
  | 'feedbacks'
  | 'signal'
  | 'threshold'
  | 'approved'
  | 'coding'
  | 'verify'
  | 'followup'

export type TraceListItem = {
  id: string
  signalId: string
  title: string
  stage: TraceStage
  taskId: string | null
  verifyStatus: string | null
  followupStatus: string | null
  updatedAt: string
}

export type TraceDetail = {
  signal: {
    id: string
    title: string
    status: string
    priority: string
    occurrences: number
    sources: string[]
    keywords: string[]
    task_id: string | null
    body: string
  } | null
  feedbacks: Array<{
    id: string
    loop_status: string
    synced_at: string
    signal_id: string | null
    excerpt: string
  }>
  threshold: {
    met: boolean
    rule: string
    taskId: string | null
  }
  task: {
    id: string
    title: string
    status: string
    priority: string
    approved_by: string | null
    approved_at: string | null
    branch: string | null
    repos: string[]
    body: string
  } | null
  coding: {
    status: string
    branch: string | null
    repos: string[]
  } | null
  verification: {
    id: string
    status: string
    checks: string[]
    commandsRun: string
    body: string
  } | null
  followup: {
    status: string
    recipient: string | null
    feedback_id: string | null
    body: string
  } | null
  stages: Array<{ id: TraceStage; label: string; done: boolean; current: boolean }>
}

function thresholdMet(sig: SignalFrontmatter): { met: boolean; rule: string } {
  if (sig.occurrences >= 2) return { met: true, rule: 'occurrences ≥ 2' }
  if (sig.priority === 'high') return { met: true, rule: 'priority: high' }
  if (sig.ready_for_task) return { met: true, rule: 'ready_for_task: true' }
  return {
    met: false,
    rule: `occurrences=${sig.occurrences} · 未达阈值（需 ≥2 / high / ready_for_task）`,
  }
}

function findTaskForSignal(signalId: string): {
  data: TaskFrontmatter & { approved_by?: string | null }
  body: string
  path: string
} | null {
  for (const f of listMarkdownFiles(PATHS.tasks)) {
    const { data, body } = readMarkdownFile<TaskFrontmatter & { approved_by?: string | null }>(f)
    if (data.source_signal === signalId || data.id.includes(signalId.replace(/^signal-/, ''))) {
      return { data, body, path: f }
    }
  }
  return null
}

function findVerification(taskId: string): {
  data: Record<string, unknown>
  body: string
  path: string
} | null {
  const preferred = path.join(PATHS.verifications, `verify-${taskId}.md`)
  const files = [
    preferred,
    ...listMarkdownFiles(PATHS.verifications).filter((f) => f.includes(taskId)),
  ]
  for (const f of files) {
    if (!existsSync(f)) continue
    const { data, body } = readMarkdownFile<Record<string, unknown>>(f)
    return { data, body, path: f }
  }
  return null
}

function findFollowup(taskId: string, signalId: string): {
  data: Record<string, unknown>
  body: string
} | null {
  for (const f of listMarkdownFiles(PATHS.followups)) {
    const { data, body } = readMarkdownFile<Record<string, unknown>>(f)
    if (String(data.task ?? '') === taskId || String(data.signal ?? '') === signalId) {
      return { data, body }
    }
  }
  return null
}

function feedbacksForSignal(sig: SignalFrontmatter): TraceDetail['feedbacks'] {
  const sourceSet = new Set(sig.sources ?? [])
  const out: TraceDetail['feedbacks'] = []
  for (const f of listMarkdownFiles(PATHS.feedback)) {
    const { data, body } = readMarkdownFile<FeedbackFrontmatter>(f)
    if (data.signal_id === sig.id || sourceSet.has(data.id) || sourceSet.has(`feedback-${data.id}`)) {
      const excerpt = body.replace(/^##\s*Content\s*/i, '').trim().slice(0, 200)
      out.push({
        id: data.id,
        loop_status: data.loop_status,
        synced_at: data.synced_at,
        signal_id: data.signal_id,
        excerpt,
      })
    }
  }
  return out
}

function computeStage(detail: {
  feedbacks: TraceDetail['feedbacks']
  thresholdMet: boolean
  task: TraceDetail['task']
  verification: TraceDetail['verification']
  followup: TraceDetail['followup']
}): TraceStage {
  if (detail.followup) return 'followup'
  if (detail.verification) return 'verify'
  if (detail.task && ['implemented', 'verified', 'in_progress', 'failed'].includes(detail.task.status)) {
    return 'coding'
  }
  if (detail.task && (detail.task.status === 'approved' || detail.task.approved_at)) {
    return 'approved'
  }
  if (detail.task) return 'threshold'
  if (detail.thresholdMet) return 'threshold'
  if (detail.feedbacks.length) return 'signal'
  return 'feedbacks'
}

function stageFlags(current: TraceStage): TraceDetail['stages'] {
  const order: Array<{ id: TraceStage; label: string }> = [
    { id: 'feedbacks', label: 'Feedbacks' },
    { id: 'signal', label: 'Signal' },
    { id: 'threshold', label: 'Threshold' },
    { id: 'approved', label: 'Approved' },
    { id: 'coding', label: 'Coding*' },
    { id: 'verify', label: 'Verify' },
    { id: 'followup', label: 'Followup' },
  ]
  const idx = order.findIndex((s) => s.id === current)
  return order.map((s, i) => ({
    ...s,
    done: i < idx || (i === idx && current === 'followup'),
    current: i === idx,
  }))
}

function parseChecks(body: string): string[] {
  return body
    .split('\n')
    .filter((l) => /^\s*-\s+/.test(l) && /passed|failed|skipped|needs_human/i.test(l))
    .map((l) => l.replace(/^\s*-\s+/, '').trim())
}

function parseCommandsRun(body: string): string {
  const m = /##\s*Commands Run\s*([\s\S]*?)(?=\n##\s|$)/i.exec(body)
  if (!m) return ''
  return m[1]!.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
}

export function getTrace(id: string): TraceDetail | null {
  let signalPath: string | null = null
  let sigData: SignalFrontmatter | null = null
  let sigBody = ''

  // resolve by signal id or task id
  if (id.startsWith('task-') || id.includes('task-')) {
    for (const f of listMarkdownFiles(PATHS.tasks)) {
      const { data } = readMarkdownFile<TaskFrontmatter>(f)
      if (data.id === id || path.basename(f).includes(id)) {
        const sid = data.source_signal
        const sp = path.join(PATHS.signals, `${sid}.md`)
        const alt = listMarkdownFiles(PATHS.signals).find((p) => p.includes(sid))
        signalPath = existsSync(sp) ? sp : alt ?? null
        break
      }
    }
  }

  if (!signalPath) {
    const sp = path.join(PATHS.signals, id.endsWith('.md') ? id : `${id}.md`)
    const alt = listMarkdownFiles(PATHS.signals).find(
      (p) => path.basename(p) === `${id}.md` || p.includes(id),
    )
    signalPath = existsSync(sp) ? sp : alt ?? null
  }

  if (!signalPath) return null
  ;({ data: sigData, body: sigBody } = readMarkdownFile<SignalFrontmatter>(signalPath))

  const feedbacks = feedbacksForSignal(sigData)
  const th = thresholdMet(sigData)
  const taskHit = findTaskForSignal(sigData.id)
  const task = taskHit
    ? {
        id: taskHit.data.id,
        title: taskHit.data.title,
        status: taskHit.data.status,
        priority: taskHit.data.priority,
        approved_by: taskHit.data.approved_by ?? null,
        approved_at: taskHit.data.approved_at ?? null,
        branch: taskHit.data.branch ?? null,
        repos: taskHit.data.repos ?? [],
        body: taskHit.body,
      }
    : null

  const verificationRaw = task ? findVerification(task.id) : null
  const verification = verificationRaw
    ? {
        id: String(verificationRaw.data.id ?? path.basename(verificationRaw.path, '.md')),
        status: String(verificationRaw.data.status ?? ''),
        checks: parseChecks(verificationRaw.body),
        commandsRun: parseCommandsRun(verificationRaw.body),
        body: verificationRaw.body,
      }
    : null

  const followupRaw = task
    ? findFollowup(task.id, sigData.id)
    : findFollowup('', sigData.id)
  const followup = followupRaw
    ? {
        status: String(followupRaw.data.status ?? 'draft'),
        recipient:
          followupRaw.data.recipient === null || followupRaw.data.recipient === undefined
            ? null
            : String(followupRaw.data.recipient),
        feedback_id: followupRaw.data.feedback_id
          ? String(followupRaw.data.feedback_id)
          : null,
        body: followupRaw.body,
      }
    : null

  const coding =
    task &&
    ['approved', 'in_progress', 'implemented', 'verified', 'failed'].includes(task.status)
      ? {
          status: task.status,
          branch: task.branch,
          repos: task.repos,
        }
      : null

  const stage = computeStage({
    feedbacks,
    thresholdMet: th.met || Boolean(task),
    task,
    verification,
    followup,
  })

  return {
    signal: {
      id: sigData.id,
      title: sigData.title,
      status: sigData.status,
      priority: sigData.priority,
      occurrences: sigData.occurrences,
      sources: sigData.sources ?? [],
      keywords: sigData.keywords ?? [],
      task_id: sigData.task_id,
      body: sigBody,
    },
    feedbacks,
    threshold: {
      met: th.met || Boolean(task),
      rule: th.rule,
      taskId: task?.id ?? sigData.task_id,
    },
    task,
    coding,
    verification,
    followup,
    stages: stageFlags(stage),
  }
}

export function listTraces(limit = 50): TraceListItem[] {
  const items: TraceListItem[] = []
  for (const f of listMarkdownFiles(PATHS.signals)) {
    const { data } = readMarkdownFile<SignalFrontmatter>(f)
    const detail = getTrace(data.id)
    if (!detail?.signal) continue
    items.push({
      id: data.id,
      signalId: data.id,
      title: data.title,
      stage: detail.stages.find((s) => s.current)?.id ?? 'signal',
      taskId: detail.task?.id ?? null,
      verifyStatus: detail.verification?.status ?? null,
      followupStatus: detail.followup?.status ?? null,
      updatedAt: data.updated_at,
    })
  }
  items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return items.slice(0, limit)
}
