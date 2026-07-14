import { getEnv } from './env.js'

export type ServeEnv = {
  port: number
  host: string
  redisUrl: string
  apiToken: string | null
  corsOrigin: string
  autoAfterApprove: boolean
  /** 全量跳过门禁；禁止默认 true */
  autoApprove: boolean
  schedulerIntervalMs: number
}

export function getServeEnv(): ServeEnv {
  const base = getEnv()
  const port = Number(process.env.LOOP_SERVE_PORT ?? 4010)
  const host = (process.env.LOOP_SERVE_HOST ?? '127.0.0.1').trim() || '127.0.0.1'
  const redisUrl = (process.env.LOOP_REDIS_URL ?? 'redis://127.0.0.1:6380').trim()
  const apiToken = process.env.LOOP_API_TOKEN?.trim() || null
  const corsOrigin = (
    process.env.LOOP_CORS_ORIGIN ?? 'http://127.0.0.1:4011,http://localhost:4011'
  ).trim()
  const autoAfterApprove = process.env.LOOP_AUTO_AFTER_APPROVE !== 'false'
  const schedulerIntervalMs = Number(process.env.LOOP_SCHEDULER_INTERVAL_MS ?? 0)

  return {
    port: Number.isFinite(port) && port > 0 ? port : 4010,
    host,
    redisUrl,
    apiToken,
    corsOrigin,
    autoAfterApprove,
    autoApprove: base.autoApprove,
    schedulerIntervalMs:
      Number.isFinite(schedulerIntervalMs) && schedulerIntervalMs > 0 ? schedulerIntervalMs : 0,
  }
}
