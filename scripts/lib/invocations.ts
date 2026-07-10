import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { PATHS } from './env.js'
import type { Invocation, InvocationStatus, LoopEventType, LoopName } from './loop-types.js'

const INV_DIR = path.join(PATHS.state, 'invocations')

function ensureDir(): void {
  mkdirSync(INV_DIR, { recursive: true })
}

function invPath(id: string): string {
  return path.join(INV_DIR, `${id}.json`)
}

export function startInvocation(opts: {
  loop: LoopName
  triggerEventId: string
  triggerEventType: LoopEventType
  taskId?: string
  workerId?: string
}): Invocation {
  ensureDir()
  const inv: Invocation = {
    id: `inv-${randomUUID()}`,
    loop: opts.loop,
    triggerEventId: opts.triggerEventId,
    triggerEventType: opts.triggerEventType,
    status: 'running',
    startedAt: new Date().toISOString(),
    taskId: opts.taskId,
    workerId: opts.workerId,
  }
  writeFileSync(invPath(inv.id), JSON.stringify(inv, null, 2), 'utf8')
  return inv
}

export function finishInvocation(
  id: string,
  status: Exclude<InvocationStatus, 'running'>,
  summary?: string,
): Invocation | null {
  const p = invPath(id)
  if (!existsSync(p)) return null
  const inv = JSON.parse(readFileSync(p, 'utf8')) as Invocation
  inv.status = status
  inv.finishedAt = new Date().toISOString()
  if (summary) inv.summary = summary
  writeFileSync(p, JSON.stringify(inv, null, 2), 'utf8')
  return inv
}

export function getInvocation(id: string): Invocation | null {
  const p = invPath(id)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8')) as Invocation
}

export function listInvocations(limit = 100): Invocation[] {
  if (!existsSync(INV_DIR)) return []
  const files = readdirSync(INV_DIR)
    .filter((n) => n.endsWith('.json'))
    .map((n) => path.join(INV_DIR, n))
  const items: Invocation[] = []
  for (const f of files) {
    try {
      items.push(JSON.parse(readFileSync(f, 'utf8')) as Invocation)
    } catch {
      // skip
    }
  }
  items.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
  return items.slice(0, limit)
}

export function latestInvocationByLoop(): Partial<Record<LoopName, Invocation>> {
  const all = listInvocations(200)
  const map: Partial<Record<LoopName, Invocation>> = {}
  for (const inv of all) {
    if (!map[inv.loop]) map[inv.loop] = inv
  }
  return map
}
