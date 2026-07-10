import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PATHS } from './env.js'
import type { LoopName, WorkerHeartbeat } from './loop-types.js'
import { ALL_LOOPS } from './loop-types.js'

const WORKERS_DIR = path.join(PATHS.state, 'workers')
const OFFLINE_MS = 45_000

function ensureDir(): void {
  mkdirSync(WORKERS_DIR, { recursive: true })
}

function workerPath(loop: LoopName): string {
  return path.join(WORKERS_DIR, `${loop}.json`)
}

export function writeWorkerHeartbeat(hb: WorkerHeartbeat): void {
  ensureDir()
  writeFileSync(workerPath(hb.loop), JSON.stringify(hb, null, 2), 'utf8')
}

export function readWorkerHeartbeat(loop: LoopName): WorkerHeartbeat | null {
  const p = workerPath(loop)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as WorkerHeartbeat
  } catch {
    return null
  }
}

export function listWorkerStatuses(): WorkerHeartbeat[] {
  const now = Date.now()
  return ALL_LOOPS.map((loop) => {
    const hb = readWorkerHeartbeat(loop)
    if (!hb) {
      return {
        loop,
        status: 'offline' as const,
        workerId: '',
        lastSeenAt: '',
      }
    }
    const age = now - Date.parse(hb.lastSeenAt)
    if (!Number.isFinite(age) || age > OFFLINE_MS) {
      return { ...hb, status: 'offline' as const }
    }
    return hb
  })
}

/** 清理残留（可选） */
export function clearStaleWorkerFiles(): void {
  if (!existsSync(WORKERS_DIR)) return
  for (const name of readdirSync(WORKERS_DIR)) {
    if (!name.endsWith('.json')) continue
  }
}
