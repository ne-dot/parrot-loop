import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PATHS } from './env.js'
import { listMarkdownFiles, readMarkdownFile } from './md.js'
import type {
  SignalFrontmatter,
  SignalPriority,
  TaskFrontmatter,
  TaskStatus,
} from './types.js'
import { ALL_LOOPS, type LoopName } from './loop-types.js'
import { listInvocations } from './invocations.js'
import { listWorkerStatuses } from './workers-status.js'

export type TaskSummary = {
  id: string
  title: string
  status: TaskStatus
  priority: SignalPriority
  source_signal: string
  branch: string | null
  approved_at: string | null
  approved_by: string | null
  created_at: string
  path: string
}

export type SignalSummary = {
  id: string
  title: string
  status: string
  priority: SignalPriority
  occurrences: number
  task_id: string | null
  updated_at: string
}

export type ProblemBuckets = {
  needsApprove: TaskSummary[]
  fixed: TaskSummary[]
  inFlight: TaskSummary[]
}

export type LoopStats = {
  fixingInPipeline: number
  pendingApproval: number
  inProgress: number
  verifiedAwaitingClose: number
  activeSignals: number
  closedSignals7d: number
  runsOk7d: number
  runsFailed7d: number
  currentRunId: string | null
}

export type ContractSummary = {
  loop: LoopName | 'product' | string
  domainPath: string
  title: string
  excerpt: string
  body: string
}

const DOMAIN_MAP: Partial<Record<LoopName, string>> = {
  feedback: 'feedback',
  task: 'product',
  coding: 'coding',
  verify: 'verifier',
  followup: 'followup',
}

function extractTitle(md: string): string {
  const h1 = /^#\s+(.+)$/m.exec(md)
  if (h1) return h1[1]!.trim()
  return 'Contract'
}

function excerpt(md: string, max = 400): string {
  const withoutFm = md.replace(/^---[\s\S]*?---\s*/, '')
  const lines = withoutFm.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
  return lines.slice(0, 8).join('\n').slice(0, max)
}

export function listContracts(): ContractSummary[] {
  const syncReadme = path.join(PATHS.domains, 'sync', 'README.md')
  const out: ContractSummary[] = []
  if (existsSync(syncReadme)) {
    const body = readFileSync(syncReadme, 'utf8')
    out.push({
      loop: 'sync',
      domainPath: syncReadme,
      title: extractTitle(body),
      excerpt: excerpt(body),
      body,
    })
  } else {
    out.push({
      loop: 'sync',
      domainPath: '(deterministic script)',
      title: 'Sync Feedback（确定性脚本）',
      excerpt:
        'sync 不是 LLM loop：从 Admin API 拉取 bug 反馈写入 artifacts/feedback。由 sync.requested 事件触发。',
      body:
        '# Sync Feedback\n\n确定性 HTTP 同步，无 LLM。\n\n触发：`sync.requested` → sync-worker → `runSyncFeedback` → `sync.completed|failed`。\n',
    })
  }

  const seenDomains = new Set<string>()
  for (const loop of ALL_LOOPS) {
    if (loop === 'sync') continue
    const domain = DOMAIN_MAP[loop] ?? loop
    if (seenDomains.has(domain)) continue
    seenDomains.add(domain)
    const domainPath = path.join(PATHS.domains, domain, 'README.md')
    if (!existsSync(domainPath)) continue
    const body = readFileSync(domainPath, 'utf8')
    out.push({
      loop,
      domainPath,
      title: extractTitle(body),
      excerpt: excerpt(body),
      body,
    })
  }

  return out
}

function asTask(data: TaskFrontmatter & { approved_by?: string | null }, filePath: string): TaskSummary {
  return {
    id: data.id,
    title: data.title,
    status: data.status,
    priority: data.priority,
    source_signal: data.source_signal,
    branch: data.branch ?? null,
    approved_at: data.approved_at ?? null,
    approved_by: data.approved_by ?? null,
    created_at: data.created_at,
    path: filePath,
  }
}

export function listTasks(): TaskSummary[] {
  return listMarkdownFiles(PATHS.tasks).map((f) => {
    const { data } = readMarkdownFile<TaskFrontmatter & { approved_by?: string | null }>(f)
    return asTask(data, f)
  })
}

export function getTask(id: string): (TaskSummary & { body: string }) | null {
  for (const f of listMarkdownFiles(PATHS.tasks)) {
    const { data, body } = readMarkdownFile<TaskFrontmatter & { approved_by?: string | null }>(f)
    if (data.id === id || path.basename(f).includes(id)) {
      return { ...asTask(data, f), body }
    }
  }
  return null
}

export function findTaskFile(id: string): string | null {
  for (const f of listMarkdownFiles(PATHS.tasks)) {
    const { data } = readMarkdownFile<TaskFrontmatter>(f)
    if (data.id === id || path.basename(f).includes(id)) return f
  }
  return null
}

export function listSignals(): SignalSummary[] {
  return listMarkdownFiles(PATHS.signals).map((f) => {
    const { data } = readMarkdownFile<SignalFrontmatter>(f)
    return {
      id: data.id,
      title: data.title,
      status: data.status,
      priority: data.priority,
      occurrences: data.occurrences,
      task_id: data.task_id,
      updated_at: data.updated_at,
    }
  })
}

/**
 * Needs Approve：proposed 且非 high（high 应由系统自动批，不应进 Gate）
 * Fixed：verified | closed
 * In Flight：approved | in_progress | implemented
 */
export function listProblems(): ProblemBuckets {
  const tasks = listTasks()
  return {
    needsApprove: tasks.filter((t) => t.status === 'proposed' && t.priority !== 'high'),
    fixed: tasks.filter((t) => t.status === 'verified' || t.status === 'closed'),
    inFlight: tasks.filter((t) =>
      t.status === 'approved' || t.status === 'in_progress' || t.status === 'implemented',
    ),
  }
}

export function computeStats(): LoopStats {
  const signals = listSignals()
  const tasks = listTasks()
  const problems = listProblems()
  const invs = listInvocations(200)
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

  const closedSignals7d = signals.filter((s) => {
    if (s.status !== 'closed' && s.status !== 'wontfix') return false
    const t = Date.parse(s.updated_at)
    return Number.isFinite(t) && t >= weekAgo
  }).length

  const runsOk7d = invs.filter((i) => {
    const t = Date.parse(i.startedAt)
    return i.status === 'ok' && Number.isFinite(t) && t >= weekAgo
  }).length

  const runsFailed7d = invs.filter((i) => {
    const t = Date.parse(i.startedAt)
    return i.status === 'failed' && Number.isFinite(t) && t >= weekAgo
  }).length

  const activeSignals = signals.filter((s) => s.status !== 'closed' && s.status !== 'wontfix')

  // fixingInPipeline：未关闭 signal，且有未拒绝/未关闭 task，或 signal 仍在流程中
  const taskBySignal = new Map(tasks.map((t) => [t.source_signal, t]))
  const fixingIds = new Set<string>()
  for (const s of activeSignals) {
    const task = s.task_id ? tasks.find((t) => t.id === s.task_id) : taskBySignal.get(s.id)
    if (task && task.status !== 'closed' && task.status !== 'failed') {
      fixingIds.add(s.id)
      continue
    }
    if (
      s.status === 'active' ||
      s.status === 'task_created' ||
      s.status === 'fixing' ||
      s.status === 'verified'
    ) {
      fixingIds.add(s.id)
    }
  }

  const running = invs.find((i) => i.status === 'running')

  return {
    fixingInPipeline: fixingIds.size,
    pendingApproval: problems.needsApprove.length,
    inProgress: problems.inFlight.length,
    verifiedAwaitingClose: tasks.filter((t) => t.status === 'verified').length,
    activeSignals: activeSignals.length,
    closedSignals7d,
    runsOk7d,
    runsFailed7d,
    currentRunId: running?.id ?? null,
  }
}

export function getContract(loop: string): ContractSummary | null {
  const all = listContracts()
  return all.find((c) => c.loop === loop || path.basename(path.dirname(c.domainPath)) === loop) ?? null
}

export function missionSnapshot() {
  return {
    workers: listWorkerStatuses(),
    latestInvocations: listInvocations(12),
    stats: computeStats(),
    problems: listProblems(),
  }
}

/** domains 目录存在性（调试） */
export function listDomainDirs(): string[] {
  if (!existsSync(PATHS.domains)) return []
  return readdirSync(PATHS.domains).filter((n) => !n.startsWith('.'))
}
