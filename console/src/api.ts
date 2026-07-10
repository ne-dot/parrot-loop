export type LoopWorker = {
  loop: string
  status: 'idle' | 'running' | 'offline'
  workerId: string
  lastSeenAt: string
  currentInvocationId?: string
  lastEventType?: string
}

export type LoopStats = {
  fixingInPipeline: number
  pendingApproval: number
  inProgress: number
  verifiedAwaitingClose: number
  activeSignals: number
  closedSignals7d: number
  runsOk7d: number
  runsFailed7d: number
  currentRunId: string | null
}

export type TaskSummary = {
  id: string
  title: string
  status: string
  priority: string
  source_signal: string
  branch: string | null
  approved_at: string | null
  approved_by: string | null
  created_at: string
  body?: string
}

export type LoopEvent = {
  id: string
  type: string
  at: string
  payload: Record<string, string | undefined>
}

export type ContractSummary = {
  loop: string
  domainPath: string
  title: string
  excerpt: string
  body?: string
}

export type Invocation = {
  id: string
  loop: string
  triggerEventType: string
  status: string
  startedAt: string
  finishedAt?: string
  summary?: string
  taskId?: string
}

const TOKEN = (import.meta.env.VITE_LOOP_API_TOKEN as string | undefined)?.trim() || ''

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (TOKEN) headers.set('Authorization', `Bearer ${TOKEN}`)
  const res = await fetch(path, { ...init, headers })
  const json = (await res.json().catch(() => null)) as T & { error?: string }
  if (!res.ok) throw new Error((json as { error?: string })?.error || res.statusText)
  return json
}

export const loopApi = {
  health: () =>
    api<{ ok: boolean; redis: boolean; workersOnline: number; workersTotal: number; redisError?: string }>(
      '/api/loop/health',
    ),
  mission: () =>
    api<{
      ok: boolean
      workers: LoopWorker[]
      latestInvocations: Invocation[]
      stats: LoopStats
      problems: { needsApprove: TaskSummary[]; fixed: TaskSummary[]; inFlight: TaskSummary[] }
    }>('/api/loop/mission'),
  events: (limit = 80) => api<{ ok: boolean; events: LoopEvent[] }>(`/api/loop/events?limit=${limit}`),
  invocations: (limit = 80) =>
    api<{ ok: boolean; invocations: Invocation[] }>(`/api/loop/invocations?limit=${limit}`),
  contracts: () => api<{ ok: boolean; contracts: ContractSummary[] }>('/api/loop/contracts'),
  contract: (loop: string) =>
    api<{ ok: boolean; contract: ContractSummary }>(`/api/loop/contracts/${loop}`),
  problems: () =>
    api<{
      ok: boolean
      problems: { needsApprove: TaskSummary[]; fixed: TaskSummary[]; inFlight: TaskSummary[] }
    }>('/api/loop/problems'),
  task: (id: string) => api<{ ok: boolean; task: TaskSummary }>(`/api/loop/tasks/${encodeURIComponent(id)}`),
  sync: () => api<{ ok: boolean; event: LoopEvent }>('/api/loop/sync', { method: 'POST', body: '{}' }),
  approve: (id: string) =>
    api<{ ok: boolean }>(`/api/loop/tasks/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: '{}',
    }),
  reject: (id: string, note?: string) =>
    api<{ ok: boolean }>(`/api/loop/tasks/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
}
