/**
 * 一 loop 一 worker：订阅对应事件 → invoke loop → publish 下一事件
 */
import { randomUUID } from 'node:crypto'
import { Worker, type Job } from 'bullmq'
import { runSyncFeedback } from '../sync-feedback.js'
import { runFeedbackLoop } from '../feedback-loop.js'
import { runTaskLoop } from '../task-loop.js'
import { runCodingLoop } from '../coding-loop.js'
import { runVerifierLoop } from '../verifier-loop.js'
import { runFollowupLoop } from '../followup-loop.js'
import { getRedisConnection, publishType } from './events.js'
import { finishInvocation, startInvocation } from './invocations.js'
import {
  ALL_LOOPS,
  LOOP_QUEUE,
  type LoopEvent,
  type LoopName,
} from './loop-types.js'
import { routeProposedTasks, assertNotFullAutoApprove } from './task-gate.js'
import { writeWorkerHeartbeat } from './workers-status.js'
import { getServeEnv } from './serve-env.js'

function statusFromCode(code: number): 'ok' | 'failed' | 'skipped' {
  if (code === 0) return 'ok'
  return 'failed'
}

async function handleSync(event: LoopEvent, workerId: string): Promise<void> {
  const inv = startInvocation({
    loop: 'sync',
    triggerEventId: event.id,
    triggerEventType: event.type,
    workerId,
  })
  writeWorkerHeartbeat({
    loop: 'sync',
    status: 'running',
    workerId,
    lastSeenAt: new Date().toISOString(),
    currentInvocationId: inv.id,
    lastEventType: event.type,
  })

  try {
    const code = await runSyncFeedback()
    const st = statusFromCode(code)
    finishInvocation(inv.id, st, `sync exit ${code}`)
    if (code === 0) {
      await publishType('sync.completed', {
        runId: inv.id,
        summary: 'sync ok',
        source: event.payload.source,
      })
    } else {
      await publishType('sync.failed', { runId: inv.id, summary: `exit ${code}` })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    finishInvocation(inv.id, 'failed', msg)
    await publishType('sync.failed', { runId: inv.id, summary: msg })
  }
}

async function handleFeedback(event: LoopEvent, workerId: string): Promise<void> {
  const inv = startInvocation({
    loop: 'feedback',
    triggerEventId: event.id,
    triggerEventType: event.type,
    workerId,
  })
  writeWorkerHeartbeat({
    loop: 'feedback',
    status: 'running',
    workerId,
    lastSeenAt: new Date().toISOString(),
    currentInvocationId: inv.id,
    lastEventType: event.type,
  })

  try {
    const code = await runFeedbackLoop()
    const st = code === 0 ? 'ok' : 'failed'
    finishInvocation(inv.id, st === 'ok' ? 'ok' : 'failed', `feedback exit ${code}`)
    if (code === 0) {
      await publishType('feedback.completed', { runId: inv.id, summary: 'feedback ok' })
    } else {
      await publishType('feedback.failed', { runId: inv.id, summary: `exit ${code}` })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    finishInvocation(inv.id, 'failed', msg)
    await publishType('feedback.failed', { runId: inv.id, summary: msg })
  }
}

async function handleTask(event: LoopEvent, workerId: string): Promise<void> {
  const inv = startInvocation({
    loop: 'task',
    triggerEventId: event.id,
    triggerEventType: event.type,
    workerId,
  })
  writeWorkerHeartbeat({
    loop: 'task',
    status: 'running',
    workerId,
    lastSeenAt: new Date().toISOString(),
    currentInvocationId: inv.id,
    lastEventType: event.type,
  })

  try {
    const code = await runTaskLoop()
    finishInvocation(inv.id, code === 0 ? 'ok' : 'failed', `task exit ${code}`)
    if (code === 0) {
      const routed = await routeProposedTasks('after task-loop')
      console.log(
        `[task-worker] routed proposed=${routed.proposed.length} autoApproved=${routed.autoApproved.length}`,
      )
    } else {
      await publishType('task.failed', { runId: inv.id, summary: `exit ${code}` })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    finishInvocation(inv.id, 'failed', msg)
    await publishType('task.failed', { runId: inv.id, summary: msg })
  }
}

async function handleCoding(event: LoopEvent, workerId: string): Promise<void> {
  const taskId = event.payload.taskId
  if (!taskId) {
    await publishType('coding.failed', { summary: 'missing taskId' })
    return
  }

  const serve = getServeEnv()
  if (!serve.autoAfterApprove) {
    console.log(`[coding-worker] LOOP_AUTO_AFTER_APPROVE=false，跳过 coding ${taskId}`)
    return
  }

  const inv = startInvocation({
    loop: 'coding',
    triggerEventId: event.id,
    triggerEventType: event.type,
    taskId,
    workerId,
  })
  writeWorkerHeartbeat({
    loop: 'coding',
    status: 'running',
    workerId,
    lastSeenAt: new Date().toISOString(),
    currentInvocationId: inv.id,
    lastEventType: event.type,
  })

  try {
    const code = await runCodingLoop(['--task', taskId])
    finishInvocation(inv.id, code === 0 ? 'ok' : 'failed', `coding exit ${code}`)
    if (code === 0) {
      await publishType('coding.completed', { taskId, runId: inv.id, summary: 'coding ok' })
    } else {
      await publishType('coding.failed', { taskId, runId: inv.id, summary: `exit ${code}` })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    finishInvocation(inv.id, 'failed', msg)
    await publishType('coding.failed', { taskId, runId: inv.id, summary: msg })
  }
}

async function handleVerify(event: LoopEvent, workerId: string): Promise<void> {
  const taskId = event.payload.taskId
  if (!taskId) {
    await publishType('verify.failed', { summary: 'missing taskId' })
    return
  }

  const inv = startInvocation({
    loop: 'verify',
    triggerEventId: event.id,
    triggerEventType: event.type,
    taskId,
    workerId,
  })
  writeWorkerHeartbeat({
    loop: 'verify',
    status: 'running',
    workerId,
    lastSeenAt: new Date().toISOString(),
    currentInvocationId: inv.id,
    lastEventType: event.type,
  })

  try {
    const code = await runVerifierLoop(['--task', taskId])
    finishInvocation(inv.id, code === 0 ? 'ok' : 'failed', `verify exit ${code}`)
    if (code === 0) {
      await publishType('verify.passed', { taskId, runId: inv.id, summary: 'verify ok' })
    } else {
      await publishType('verify.failed', { taskId, runId: inv.id, summary: `exit ${code}` })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    finishInvocation(inv.id, 'failed', msg)
    await publishType('verify.failed', { taskId, runId: inv.id, summary: msg })
  }
}

async function handleFollowup(event: LoopEvent, workerId: string): Promise<void> {
  const taskId = event.payload.taskId
  if (!taskId) {
    await publishType('followup.failed', { summary: 'missing taskId' })
    return
  }

  const inv = startInvocation({
    loop: 'followup',
    triggerEventId: event.id,
    triggerEventType: event.type,
    taskId,
    workerId,
  })
  writeWorkerHeartbeat({
    loop: 'followup',
    status: 'running',
    workerId,
    lastSeenAt: new Date().toISOString(),
    currentInvocationId: inv.id,
    lastEventType: event.type,
  })

  try {
    const code = await runFollowupLoop(['--task', taskId])
    finishInvocation(inv.id, code === 0 ? 'ok' : 'failed', `followup exit ${code}`)
    if (code === 0) {
      await publishType('followup.completed', { taskId, runId: inv.id, summary: 'followup draft ok' })
    } else {
      await publishType('followup.failed', { taskId, runId: inv.id, summary: `exit ${code}` })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    finishInvocation(inv.id, 'failed', msg)
    await publishType('followup.failed', { taskId, runId: inv.id, summary: msg })
  }
}

const HANDLERS: Record<LoopName, (e: LoopEvent, workerId: string) => Promise<void>> = {
  sync: handleSync,
  feedback: handleFeedback,
  task: handleTask,
  coding: handleCoding,
  verify: handleVerify,
  followup: handleFollowup,
}

export function parseLoopArg(argv: string[]): LoopName | null {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--loop') {
      const v = argv[i + 1]
      if (v && (ALL_LOOPS as string[]).includes(v)) return v as LoopName
    }
  }
  return null
}

export async function startLoopWorker(loop: LoopName): Promise<Worker> {
  assertNotFullAutoApprove()
  const workerId = `${loop}-${randomUUID().slice(0, 8)}`
  const queueName = LOOP_QUEUE[loop]
  const handler = HANDLERS[loop]

  const heartbeat = () => {
    writeWorkerHeartbeat({
      loop,
      status: 'idle',
      workerId,
      lastSeenAt: new Date().toISOString(),
    })
  }
  heartbeat()
  const timer = setInterval(heartbeat, 15_000)

  const worker = new Worker(
    queueName,
    async (job: Job<LoopEvent>) => {
      const event = job.data
      console.log(`[${loop}-worker] ← ${event.type} (${event.id})`)
      await handler(event, workerId)
      writeWorkerHeartbeat({
        loop,
        status: 'idle',
        workerId,
        lastSeenAt: new Date().toISOString(),
        lastEventType: event.type,
      })
    },
    {
      connection: getRedisConnection(),
      concurrency: 1,
      lockDuration: loop === 'coding' ? 30 * 60_000 : 10 * 60_000,
    },
  )

  worker.on('failed', (job, err) => {
    console.error(`[${loop}-worker] job failed:`, job?.id, err.message)
  })

  worker.on('closed', () => clearInterval(timer))

  console.log(`[${loop}-worker] listening on queue ${queueName} (id=${workerId})`)
  return worker
}
