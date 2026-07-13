/**
 * 需求 2.2.4：signal 二十四小时分窗（锚点 created_at）。
 */
import type { SignalFrontmatter, SignalStatus } from './types.js'

export const DEFAULT_SIGNAL_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000

/** 非 active：已进入出单/终态，超窗则应新建 signal 而非合并 */
const NON_ACTIVE_FOR_WINDOW: ReadonlySet<SignalStatus> = new Set([
  'task_created',
  'fixing',
  'verified',
  'closed',
  'wontfix',
])

export function getSignalDedupWindowMs(): number {
  const n = Number(process.env.LOOP_SIGNAL_DEDUP_WINDOW_MS)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SIGNAL_DEDUP_WINDOW_MS
}

/** 距 created_at 是否仍在分窗内 */
export function isWithinSignalWindow(
  createdAt: string,
  now: Date = new Date(),
  windowMs: number = getSignalDedupWindowMs(),
): boolean {
  const t = Date.parse(createdAt)
  if (!Number.isFinite(t)) return false
  return now.getTime() - t <= windowMs
}

/**
 * 语义已判定相同的前提下：是否应合并进该 signal。
 * - active → 始终合并
 * - 非 active → 仅当仍在 created_at 分窗内
 */
export function shouldMergeIntoSignal(
  signal: Pick<SignalFrontmatter, 'status' | 'created_at'>,
  now: Date = new Date(),
  windowMs: number = getSignalDedupWindowMs(),
): boolean {
  if (signal.status === 'active') return true
  if (!NON_ACTIVE_FOR_WINDOW.has(signal.status)) {
    // 未知状态：保守按非 active 处理
    return isWithinSignalWindow(signal.created_at, now, windowMs)
  }
  return isWithinSignalWindow(signal.created_at, now, windowMs)
}

/** 本轮 feedback 关联到该 signal 是否违反分窗（供 Verify） */
export function isOverWindowMergeViolation(
  signal: Pick<SignalFrontmatter, 'status' | 'created_at' | 'id'>,
  now: Date = new Date(),
  windowMs: number = getSignalDedupWindowMs(),
): boolean {
  return !shouldMergeIntoSignal(signal, now, windowMs)
}
