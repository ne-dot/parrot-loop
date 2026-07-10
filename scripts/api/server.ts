/**
 * Control Plane HTTP API
 * Base: /api/loop/*
 */
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { listEvents } from '../lib/event-log.js'
import { pingRedis, publishType } from '../lib/events.js'
import { listInvocations, getInvocation } from '../lib/invocations.js'
import {
  computeStats,
  getContract,
  getTask,
  listContracts,
  listProblems,
  listSignals,
  listTasks,
  missionSnapshot,
} from '../lib/loop-index.js'
import { PATHS } from '../lib/env.js'
import { getServeEnv } from '../lib/serve-env.js'
import { approveTask, rejectTask } from '../lib/task-gate.js'
import { listWorkerStatuses } from '../lib/workers-status.js'

const CONSOLE_DIST = path.join(PATHS.root, 'console', 'dist')

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const { apiToken } = getServeEnv()
  if (!apiToken) {
    next()
    return
  }
  const header = req.header('authorization') ?? ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const alt = req.header('x-loop-token')?.trim() ?? ''
  if (bearer === apiToken || alt === apiToken) {
    next()
    return
  }
  // 只读 health 放行
  if (req.method === 'GET' && req.path.endsWith('/health')) {
    next()
    return
  }
  res.status(401).json({ ok: false, error: 'unauthorized' })
}

export function createLoopApiApp() {
  const app = express()
  const serve = getServeEnv()

  app.use(
    cors({
      origin: serve.corsOrigin === '*' ? true : serve.corsOrigin.split(',').map((s: string) => s.trim()),
      credentials: true,
    }),
  )
  app.use(express.json({ limit: '1mb' }))

  const api = express.Router()
  api.use(authMiddleware)

  api.get('/health', async (_req, res) => {
    const redis = await pingRedis()
    const workers = listWorkerStatuses()
    const online = workers.filter((w) => w.status !== 'offline').length
    res.json({
      ok: true,
      redis: redis.ok,
      redisError: redis.error,
      workersOnline: online,
      workersTotal: workers.length,
      schedulerIntervalMs: serve.schedulerIntervalMs,
      autoAfterApprove: serve.autoAfterApprove,
    })
  })

  api.get('/stats', (_req, res) => {
    res.json({ ok: true, stats: computeStats() })
  })

  api.get('/mission', (_req, res) => {
    res.json({ ok: true, ...missionSnapshot() })
  })

  api.get('/events', (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500)
    res.json({ ok: true, events: listEvents(limit) })
  })

  api.get('/invocations', (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500)
    res.json({ ok: true, invocations: listInvocations(limit) })
  })

  api.get('/invocations/:id', (req, res) => {
    const inv = getInvocation(req.params.id!)
    if (!inv) {
      res.status(404).json({ ok: false, error: 'not found' })
      return
    }
    res.json({ ok: true, invocation: inv })
  })

  api.get('/workers', (_req, res) => {
    res.json({ ok: true, workers: listWorkerStatuses() })
  })

  api.get('/problems', (_req, res) => {
    res.json({ ok: true, problems: listProblems() })
  })

  api.get('/contracts', (_req, res) => {
    res.json({
      ok: true,
      contracts: listContracts().map(({ body: _b, ...rest }) => rest),
    })
  })

  api.get('/contracts/:loop', (req, res) => {
    const c = getContract(req.params.loop!)
    if (!c) {
      res.status(404).json({ ok: false, error: 'not found' })
      return
    }
    res.json({ ok: true, contract: c })
  })

  api.get('/tasks', (req, res) => {
    let tasks = listTasks()
    const status = req.query.status as string | undefined
    if (status) tasks = tasks.filter((t) => t.status === status)
    res.json({ ok: true, tasks })
  })

  api.get('/tasks/:id', (req, res) => {
    const task = getTask(req.params.id!)
    if (!task) {
      res.status(404).json({ ok: false, error: 'not found' })
      return
    }
    res.json({ ok: true, task })
  })

  api.get('/signals', (_req, res) => {
    res.json({ ok: true, signals: listSignals() })
  })

  /** 手动 SYNC NOW */
  api.post('/sync', async (req, res) => {
    try {
      const event = await publishType('sync.requested', {
        source: 'web',
        summary: (req.body?.summary as string) || 'SYNC NOW',
      })
      res.json({ ok: true, event })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      res.status(503).json({ ok: false, error: message })
    }
  })

  api.post('/tasks/:id/approve', async (req, res) => {
    const result = await approveTask(req.params.id!, { by: 'admin' })
    if (!result.ok) {
      res.status(400).json(result)
      return
    }
    res.json(result)
  })

  api.post('/tasks/:id/reject', async (req, res) => {
    const note = typeof req.body?.note === 'string' ? req.body.note : undefined
    const result = await rejectTask(req.params.id!, note)
    if (!result.ok) {
      res.status(400).json(result)
      return
    }
    res.json(result)
  })

  /** SSE：简单轮询推送最近事件 */
  api.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    let lastCount = listEvents(500).length
    const send = () => {
      const events = listEvents(20)
      res.write(`data: ${JSON.stringify({ events, workers: listWorkerStatuses() })}\n\n`)
    }
    send()

    const timer = setInterval(() => {
      const n = listEvents(500).length
      if (n !== lastCount) {
        lastCount = n
        send()
      } else {
        res.write(`: ping\n\n`)
      }
    }, 2000)

    req.on('close', () => clearInterval(timer))
  })

  app.use('/api/loop', api)

  if (existsSync(CONSOLE_DIST)) {
    app.use(express.static(CONSOLE_DIST))
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(CONSOLE_DIST, 'index.html'))
    })
  } else {
    app.get('/', (_req, res) => {
      res.json({
        ok: true,
        service: 'loop-engineer-serve',
        docs: '/api/loop/health',
        console: '未构建：cd console && npm run build；开发：npm run console:dev → :4011',
      })
    })
  }

  return app
}

export async function listenLoopApi(): Promise<{ port: number; host: string }> {
  const serve = getServeEnv()
  const app = createLoopApiApp()
  await new Promise<void>((resolve) => {
    app.listen(serve.port, serve.host, () => resolve())
  })
  return { port: serve.port, host: serve.host }
}
