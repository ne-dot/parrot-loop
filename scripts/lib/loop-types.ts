/** 2.2.2 事件与 Invocation 类型 */

export type LoopName = 'sync' | 'feedback' | 'task' | 'coding' | 'verify' | 'followup'

export type LoopEventType =
  | 'sync.requested'
  | 'sync.completed'
  | 'sync.failed'
  | 'feedback.completed'
  | 'feedback.failed'
  | 'task.proposed'
  | 'task.approved'
  | 'task.rejected'
  | 'task.failed'
  | 'coding.completed'
  | 'coding.failed'
  | 'verify.passed'
  | 'verify.failed'
  | 'followup.completed'
  | 'followup.failed'

export type LoopEvent = {
  id: string
  type: LoopEventType
  at: string
  payload: {
    runId?: string
    taskId?: string
    signalId?: string
    summary?: string
    priority?: string
    source?: string
  }
}

export type InvocationStatus = 'running' | 'ok' | 'failed' | 'skipped'

export type Invocation = {
  id: string
  loop: LoopName
  triggerEventId: string
  triggerEventType: LoopEventType
  status: InvocationStatus
  startedAt: string
  finishedAt?: string
  summary?: string
  taskId?: string
  workerId?: string
}

export type WorkerHeartbeat = {
  loop: LoopName
  status: 'idle' | 'running' | 'offline'
  workerId: string
  lastSeenAt: string
  currentInvocationId?: string
  lastEventType?: string
}

/** 事件 → 消费该事件的 queue / loop */
export const EVENT_TO_LOOP: Partial<Record<LoopEventType, LoopName>> = {
  'sync.requested': 'sync',
  'sync.completed': 'feedback',
  'feedback.completed': 'task',
  'task.approved': 'coding',
  'coding.completed': 'verify',
  'verify.passed': 'followup',
}

export const LOOP_QUEUE: Record<LoopName, string> = {
  sync: 'loop-sync',
  feedback: 'loop-feedback',
  task: 'loop-task',
  coding: 'loop-coding',
  verify: 'loop-verify',
  followup: 'loop-followup',
}

export const ALL_LOOPS: LoopName[] = [
  'sync',
  'feedback',
  'task',
  'coding',
  'verify',
  'followup',
]
