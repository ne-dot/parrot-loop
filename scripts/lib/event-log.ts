import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PATHS } from './env.js'
import type { LoopEvent } from './loop-types.js'

const EVENTS_DIR = path.join(PATHS.state, 'events')
const EVENTS_FILE = path.join(EVENTS_DIR, 'events.jsonl')
const MAX_EVENTS = 500

function ensureDir(): void {
  mkdirSync(EVENTS_DIR, { recursive: true })
}

export function appendEventLog(event: LoopEvent): void {
  ensureDir()
  appendFileSync(EVENTS_FILE, `${JSON.stringify(event)}\n`, 'utf8')
}

export function listEvents(limit = 100): LoopEvent[] {
  if (!existsSync(EVENTS_FILE)) return []
  const raw = readFileSync(EVENTS_FILE, 'utf8')
  const lines = raw.split('\n').filter(Boolean)
  const slice = lines.slice(-Math.min(limit, MAX_EVENTS))
  const out: LoopEvent[] = []
  for (const line of slice) {
    try {
      out.push(JSON.parse(line) as LoopEvent)
    } catch {
      // skip bad line
    }
  }
  return out.reverse()
}

/** 可选：裁剪过大的 jsonl */
export function trimEventLog(): void {
  if (!existsSync(EVENTS_FILE)) return
  const events = listEvents(MAX_EVENTS)
  writeFileSync(
    EVENTS_FILE,
    events
      .slice()
      .reverse()
      .map((e) => JSON.stringify(e))
      .join('\n') + (events.length ? '\n' : ''),
    'utf8',
  )
}
