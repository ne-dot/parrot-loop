import { randomUUID } from 'node:crypto'
import { Queue, type ConnectionOptions } from 'bullmq'
import { getServeEnv } from './serve-env.js'
import { appendEventLog } from './event-log.js'
import { EVENT_TO_LOOP, LOOP_QUEUE, type LoopEvent, type LoopEventType } from './loop-types.js'

let sharedConnection: ConnectionOptions | null = null
const queues = new Map<string, Queue>()

export function getRedisConnection(): ConnectionOptions {
  if (sharedConnection) return sharedConnection
  const { redisUrl } = getServeEnv()
  // BullMQ 接受 ioredis 风格 connection；用 url 字符串拆 host/port 更稳
  try {
    const u = new URL(redisUrl)
    sharedConnection = {
      host: u.hostname || '127.0.0.1',
      port: Number(u.port || 6379),
      maxRetriesPerRequest: null,
    }
  } catch {
    sharedConnection = { host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null }
  }
  return sharedConnection
}

function getQueue(name: string): Queue {
  let q = queues.get(name)
  if (!q) {
    q = new Queue(name, { connection: getRedisConnection() })
    queues.set(name, q)
  }
  return q
}

export function createEvent(
  type: LoopEventType,
  payload: LoopEvent['payload'] = {},
): LoopEvent {
  return {
    id: `evt-${randomUUID()}`,
    type,
    at: new Date().toISOString(),
    payload,
  }
}

/**
 * 发布事件：落盘 event-log +（若有订阅 loop）入对应 BullMQ queue。
 * 无订阅方的事件（如 task.proposed、*.failed）只落盘，供 Web 审计。
 */
export async function publish(event: LoopEvent): Promise<LoopEvent> {
  appendEventLog(event)

  const loop = EVENT_TO_LOOP[event.type]
  if (loop) {
    const queueName = LOOP_QUEUE[loop]
    const queue = getQueue(queueName)
    await queue.add(event.type, event, {
      jobId: event.id.replace(/:/g, '-'),
      removeOnComplete: 100,
      removeOnFail: 50,
    })
  }

  return event
}

export async function publishType(
  type: LoopEventType,
  payload: LoopEvent['payload'] = {},
): Promise<LoopEvent> {
  return publish(createEvent(type, payload))
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()))
  queues.clear()
}

/** 探测 Redis 是否可达 */
export async function pingRedis(): Promise<{ ok: boolean; error?: string }> {
  try {
    const q = getQueue('loop-health-ping')
    const client = await q.client
    const pong = await (client as unknown as { ping: () => Promise<string> }).ping()
    return { ok: pong === 'PONG' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
