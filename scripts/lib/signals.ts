import { existsSync } from 'node:fs'
import { PATHS } from './env.js'
import { listMarkdownFiles, readMarkdownFile } from './md.js'
import type { SignalArtifact, SignalFrontmatter, TaskFrontmatter } from './types.js'

export function loadSignals(): SignalArtifact[] {
  if (!existsSync(PATHS.signals)) return []
  return listMarkdownFiles(PATHS.signals).map((filePath) => {
    const { data, body } = readMarkdownFile<SignalFrontmatter>(filePath)
    if (!Array.isArray(data.sources)) data.sources = []
    if (!Array.isArray(data.keywords)) data.keywords = []
    return { path: filePath, data, body }
  })
}

export function loadTasks(): Array<{ path: string; data: TaskFrontmatter }> {
  if (!existsSync(PATHS.tasks)) return []
  return listMarkdownFiles(PATHS.tasks).map((filePath) => {
    const { data } = readMarkdownFile<TaskFrontmatter>(filePath)
    if (!Array.isArray(data.repos)) data.repos = []
    return { path: filePath, data }
  })
}

/** 合同阈值：occurrences>=2 或 priority=high 或 ready_for_task */
export function meetsTaskThreshold(signal: SignalFrontmatter): boolean {
  return (
    Number(signal.occurrences) >= 2 ||
    signal.priority === 'high' ||
    signal.ready_for_task === true
  )
}

export function hasOpenTaskForSignal(
  signalId: string,
  tasks: Array<{ data: TaskFrontmatter }>,
): boolean {
  return tasks.some(
    (t) =>
      t.data.source_signal === signalId &&
      t.data.status !== 'closed' &&
      t.data.status !== 'failed',
  )
}

export type EligibleSignal = {
  id: string
  title: string
  reason: string
  path: string
}

/** 预扫描：哪些 signal 应由 task agent 出 proposed task */
export function listEligibleSignals(): {
  eligible: EligibleSignal[]
  skipped: Array<{ id: string; reason: string }>
} {
  const signals = loadSignals()
  const tasks = loadTasks()
  const eligible: EligibleSignal[] = []
  const skipped: Array<{ id: string; reason: string }> = []

  for (const s of signals) {
    if (s.data.status !== 'active') {
      skipped.push({ id: s.data.id, reason: `status=${s.data.status}` })
      continue
    }
    if (s.data.task_id) {
      skipped.push({ id: s.data.id, reason: `已挂 task_id=${s.data.task_id}` })
      continue
    }
    if (hasOpenTaskForSignal(s.data.id, tasks)) {
      skipped.push({ id: s.data.id, reason: '已有未关闭 task' })
      continue
    }
    if (!meetsTaskThreshold(s.data)) {
      skipped.push({
        id: s.data.id,
        reason: `未达阈值（occurrences=${s.data.occurrences}, priority=${s.data.priority}, ready_for_task=${s.data.ready_for_task}）`,
      })
      continue
    }

    const reasons: string[] = []
    if (Number(s.data.occurrences) >= 2) reasons.push(`occurrences=${s.data.occurrences}`)
    if (s.data.priority === 'high') reasons.push('priority=high')
    if (s.data.ready_for_task) reasons.push('ready_for_task')
    eligible.push({
      id: s.data.id,
      title: s.data.title,
      reason: reasons.join(', '),
      path: s.path,
    })
  }

  return { eligible, skipped }
}
