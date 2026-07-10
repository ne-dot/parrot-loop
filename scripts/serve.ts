/**
 * Control Plane：只读 API + 手动 SYNC publish
 * 用法：loop-engineer serve [--port 4010]
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { listenLoopApi } from './api/server.js'
import { getServeEnv } from './lib/serve-env.js'
import { listTasks } from './lib/loop-index.js'
import { approveTask } from './lib/task-gate.js'
import { pingRedis } from './lib/events.js'

function parsePort(argv: string[]): number | null {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port') {
      const n = Number(argv[i + 1])
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return null
}

export async function runServe(argv = process.argv.slice(2)): Promise<void> {
  const portOverride = parsePort(argv)
  if (portOverride) process.env.LOOP_SERVE_PORT = String(portOverride)

  const serve = getServeEnv()
  if (serve.schedulerIntervalMs > 0) {
    console.warn(
      `[serve] LOOP_SCHEDULER_INTERVAL_MS=${serve.schedulerIntervalMs} 已配置，但本版 P0 不启用定时 sync（仅手动 SYNC NOW）`,
    )
  }

  const { host, port } = await listenLoopApi()
  console.log(`[serve] Loop Engineer Control Plane http://${host}:${port}`)
  console.log(`[serve] health: http://${host}:${port}/api/loop/health`)
  console.log('[serve] sync: POST /api/loop/sync （手动；无默认定时）')

  const redis = await pingRedis()
  if (!redis.ok) {
    console.warn(`[serve] Redis 不可达：${redis.error ?? 'unknown'}（只读 API 仍可用；publish 会失败）`)
  } else {
    console.log('[serve] Redis ok')
  }

  // 启动时：仍为 proposed 的 high task 补一次系统批准（幂等）
  try {
    const highs = listTasks().filter((t) => t.status === 'proposed' && t.priority === 'high')
    for (const t of highs) {
      const r = await approveTask(t.id, { by: 'system', note: 'serve boot: high auto-approve' })
      if (r.ok) console.log(`[serve] auto-approved high task ${t.id}`)
    }
  } catch (err) {
    console.warn('[serve] high auto-approve scan skipped:', err)
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  runServe().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
