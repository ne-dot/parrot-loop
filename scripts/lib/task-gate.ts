/**
 * Task 门禁：批准 / 驳回 / high 自动批
 */
import { appendLog } from './log.js'
import { findTaskFile, getTask } from './loop-index.js'
import { readMarkdownFile, writeMarkdownFile } from './md.js'
import { publishType } from './events.js'
import { getServeEnv } from './serve-env.js'
import type { TaskFrontmatter } from './types.js'

export type TaskFm = TaskFrontmatter & {
  approved_by?: string | null
  rejected_at?: string | null
  reject_note?: string | null
}

export async function approveTask(
  taskId: string,
  opts: { by: 'admin' | 'system'; note?: string } = { by: 'admin' },
): Promise<{ ok: true; taskId: string } | { ok: false; error: string }> {
  const file = findTaskFile(taskId)
  if (!file) return { ok: false, error: `task not found: ${taskId}` }

  const { data, body } = readMarkdownFile<TaskFm>(file)
  if (data.status === 'approved') {
    return { ok: true, taskId: data.id }
  }
  if (data.status !== 'proposed') {
    return { ok: false, error: `cannot approve status=${data.status}` }
  }

  const now = new Date().toISOString()
  data.status = 'approved'
  data.approved_at = now
  data.approved_by = opts.by
  writeMarkdownFile(file, data as unknown as Record<string, unknown>, body)

  appendLog({
    loop: 'gate',
    status: 'ok',
    summary: `task ${taskId} approved_by=${opts.by}`,
    details: opts.note ? [opts.note] : undefined,
  })

  const serve = getServeEnv()
  if (serve.autoAfterApprove || opts.by === 'system') {
    await publishType('task.approved', {
      taskId: data.id,
      summary: data.title,
      priority: data.priority,
      source: opts.by,
    })
  }

  return { ok: true, taskId: data.id }
}

export async function rejectTask(
  taskId: string,
  note?: string,
): Promise<{ ok: true; taskId: string } | { ok: false; error: string }> {
  const file = findTaskFile(taskId)
  if (!file) return { ok: false, error: `task not found: ${taskId}` }

  const { data, body } = readMarkdownFile<TaskFm>(file)
  if (data.status !== 'proposed') {
    return { ok: false, error: `cannot reject status=${data.status}` }
  }

  const now = new Date().toISOString()
  // 用 closed + reject 元数据；types 无 rejected，保持兼容
  ;(data as TaskFm).status = 'closed'
  ;(data as TaskFm).rejected_at = now
  ;(data as TaskFm).reject_note = note ?? null
  writeMarkdownFile(file, data as unknown as Record<string, unknown>, body)

  appendLog({
    loop: 'gate',
    status: 'ok',
    summary: `task ${taskId} rejected`,
    details: note ? [note] : undefined,
  })

  await publishType('task.rejected', {
    taskId: data.id,
    summary: note ?? data.title,
  })

  return { ok: true, taskId: data.id }
}

/**
 * task-loop 结束后：对每条 proposed 发 task.proposed；
 * high → 系统自动 approved + task.approved
 */
export async function routeProposedTasks(summary?: string): Promise<{
  proposed: string[]
  autoApproved: string[]
}> {
  const { listTasks } = await import('./loop-index.js')
  const proposed = listTasks().filter((t) => t.status === 'proposed')
  const autoApproved: string[] = []
  const proposedIds: string[] = []

  for (const t of proposed) {
    proposedIds.push(t.id)
    await publishType('task.proposed', {
      taskId: t.id,
      summary: t.title,
      priority: t.priority,
    })

    if (t.priority === 'high') {
      const r = await approveTask(t.id, { by: 'system', note: 'priority=high auto-approve' })
      if (r.ok) autoApproved.push(t.id)
    }
  }

  if (summary) {
    appendLog({
      loop: 'task-route',
      status: 'ok',
      summary,
      details: [
        `proposed=${proposedIds.length}`,
        `autoApproved(high)=${autoApproved.length}`,
      ],
    })
  }

  return { proposed: proposedIds, autoApproved }
}

export function assertNotFullAutoApprove(): void {
  const serve = getServeEnv()
  if (serve.autoApprove) {
    console.warn(
      '[loop-engineer] WARNING: LOOP_AUTO_APPROVE=true 已开启（全量跳过门禁）。产品默认应为 false。',
    )
  }
}

export { getTask }
