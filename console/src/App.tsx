import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  loopApi,
  type ContractSummary,
  type LoopEvent,
  type LoopStats,
  type LoopWorker,
  type TaskSummary,
} from './api'

type Tab = 'mission' | 'problems' | 'contracts' | 'events' | 'approve'

const TABS: { id: Tab; label: string }[] = [
  { id: 'mission', label: 'Mission' },
  { id: 'problems', label: 'Problems' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'events', label: 'Events' },
  { id: 'approve', label: 'Gate' },
]

const WORKER_META: Record<
  string,
  {
    orb: string
    name: string
    on: string
    contract: string
    hasContract: boolean
    kind: 'script' | 'agent'
  }
> = {
  sync: {
    orb: 'SYNC',
    name: 'sync-worker',
    on: 'on sync.requested',
    contract: 'sync',
    hasContract: false,
    kind: 'script',
  },
  feedback: {
    orb: 'FB',
    name: 'feedback',
    on: 'on sync.completed',
    contract: 'feedback',
    hasContract: true,
    kind: 'agent',
  },
  task: {
    orb: 'TASK',
    name: 'task-worker',
    on: 'on feedback.completed',
    contract: 'task',
    hasContract: true,
    kind: 'agent',
  },
  coding: {
    orb: 'CODE',
    name: 'coding',
    on: 'on task.approved',
    contract: 'coding',
    hasContract: true,
    kind: 'agent',
  },
  verify: {
    orb: 'VFY',
    name: 'verify',
    on: 'on coding.completed',
    contract: 'verify',
    hasContract: true,
    kind: 'agent',
  },
  followup: {
    orb: 'FU',
    name: 'followup',
    on: 'on verify.passed',
    contract: 'followup',
    hasContract: true,
    kind: 'agent',
  },
}

const DISPLAY_LOOPS = ['sync', 'feedback', 'task', 'coding', 'verify', 'followup'] as const

function fmtTime(iso: string): string {
  try {
    return iso.slice(11, 19)
  } catch {
    return iso
  }
}

function renderContractHtml(body: string): string {
  return body
    .split(/\n\n+/)
    .map((block, i) => {
      const lines = block.split('\n')
      if (i === 0) return `<div>${lines.join('<br>')}</div>`
      return `<div class="sec">${lines[0] ?? ''}</div><div>${lines.slice(1).join('<br>')}</div>`
    })
    .join('')
}

export default function App() {
  const [tab, setTab] = useState<Tab>('mission')
  const [reachable, setReachable] = useState(true)
  const [banner, setBanner] = useState('')
  const [workers, setWorkers] = useState<LoopWorker[]>([])
  const [stats, setStats] = useState<LoopStats | null>(null)
  const [problems, setProblems] = useState<{
    needsApprove: TaskSummary[]
    fixed: TaskSummary[]
    inFlight: TaskSummary[]
  }>({ needsApprove: [], fixed: [], inFlight: [] })
  const [events, setEvents] = useState<LoopEvent[]>([])
  const [contracts, setContracts] = useState<ContractSummary[]>([])
  const [contractKey, setContractKey] = useState('feedback')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  const [gateTask, setGateTask] = useState<TaskSummary | null>(null)
  const [contractDrawer, setContractDrawer] = useState<ContractSummary | null>(null)

  const onlineCount = useMemo(
    () => workers.filter((w) => w.status !== 'offline').length,
    [workers],
  )
  const runningCount = useMemo(
    () => workers.filter((w) => w.status === 'running').length,
    [workers],
  )

  const activeContract = useMemo(() => {
    return contracts.find((c) => c.loop === contractKey) ?? contracts[0] ?? null
  }, [contracts, contractKey])

  const refresh = useCallback(async () => {
    try {
      const health = await loopApi.health()
      setReachable(true)
      const notes: string[] = []
      if (!health.redis) notes.push(`Redis 不可达${health.redisError ? `：${health.redisError}` : ''}`)
      if (health.workersOnline === 0) {
        notes.push('无 worker 在线 — 请执行 loop-engineer workers')
      }
      setBanner(notes.join(' · '))

      const mission = await loopApi.mission()
      setWorkers(mission.workers)
      setStats(mission.stats)
      setProblems(mission.problems)

      const ev = await loopApi.events(60)
      setEvents(ev.events)

      if (contracts.length === 0) {
        const c = await loopApi.contracts()
        setContracts(c.contracts)
      }
    } catch (err) {
      setReachable(false)
      setBanner(
        err instanceof Error
          ? err.message
          : '请启动 loop-engineer serve 与各 worker --loop …',
      )
    }
  }, [contracts.length])

  useEffect(() => {
    if (tab !== 'contracts' || !contractKey) return
    void loopApi
      .contract(contractKey)
      .then((r) => {
        setContracts((prev) => {
          const rest = prev.filter((c) => c.loop !== r.contract.loop)
          return [...rest, r.contract]
        })
      })
      .catch(() => {
        /* ignore */
      })
  }, [tab, contractKey])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 3000)
    return () => clearInterval(t)
  }, [refresh])

  async function onSync() {
    setBusy(true)
    setToast('')
    try {
      const r = await loopApi.sync()
      setToast(`已发 ${r.event.type}`)
      await refresh()
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function openContract(loop: string) {
    try {
      const r = await loopApi.contract(loop)
      setContractDrawer(r.contract)
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err))
    }
  }

  async function openGate(task: TaskSummary) {
    try {
      const r = await loopApi.task(task.id)
      setGateTask(r.task)
    } catch {
      setGateTask(task)
    }
  }

  async function doApprove() {
    if (!gateTask) return
    setBusy(true)
    try {
      await loopApi.approve(gateTask.id)
      setToast(`已批准 ${gateTask.id} → task.approved`)
      setGateTask(null)
      await refresh()
      setTab('mission')
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function doReject() {
    if (!gateTask) return
    setBusy(true)
    try {
      await loopApi.reject(gateTask.id, 'rejected from Gate')
      setToast(`已驳回 ${gateTask.id}`)
      setGateTask(null)
      await refresh()
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function workerByLoop(loop: string): LoopWorker | undefined {
    return workers.find((w) => w.loop === loop)
  }

  return (
    <>
      <div className="scanline" />
      <div className="app">
        <header className="top">
          <div className="brand">
            <div className="mark" aria-hidden />
            <div>
              <h1>LOOP ENGINEER</h1>
              <p>MISSION CONSOLE · V2.2.2 · EVENT-DRIVEN</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className={`live-badge${reachable ? '' : ' is-down'}`}>
              <i />
              {reachable ? `${onlineCount} WORKERS · LIVE` : 'OFFLINE'}
            </span>
            <nav className="nav">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={tab === t.id ? 'is-on' : ''}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
        </header>

        {!reachable || banner ? (
          <div
            className="note"
            style={{
              marginBottom: 14,
              borderColor: reachable ? 'rgba(251,191,36,0.35)' : 'rgba(251,113,133,0.4)',
              color: reachable ? 'var(--amber)' : 'var(--rose)',
            }}
          >
            {reachable
              ? `提示：${banner}`
              : `Control Plane 未连接：${banner || '请启动 loop-engineer serve'}`}
          </div>
        ) : null}

        {toast ? (
          <p className="note" style={{ color: 'var(--mint)', marginTop: 0 }}>
            {toast}
          </p>
        ) : null}

        {tab === 'mission' ? (
          <section className="view is-on">
            <div className="theater">
              <div className="theater-head">
                <div>
                  <h2>LOOP WORKERS</h2>
                  <div className="meta">
                    每个 loop = 一个独立 worker。
                    <span className="pill pill-sys" style={{ marginLeft: 6 }}>SCRIPT</span> = 确定性拉取工具；
                    <span className="pill pill-run" style={{ marginLeft: 4 }}>AGENT</span> = AI loop（有合同）。
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" type="button" disabled={busy || !reachable} onClick={() => void onSync()}>
                    SYNC NOW
                  </button>
                </div>
              </div>

              <div className="workers">
                {DISPLAY_LOOPS.map((loop) => {
                  const meta = WORKER_META[loop]!
                  const w = workerByLoop(loop)
                  const status = w?.status ?? 'offline'
                  const cls =
                    status === 'running' ? 'is-running' : status === 'offline' ? 'is-idle' : 'is-idle'
                  const clickable = meta.hasContract
                  const kindCls = meta.kind === 'script' ? 'is-script' : 'is-agent'
                  return (
                    <div
                      key={loop}
                      className={`worker ${cls} ${kindCls}`}
                      style={{
                        ...(status === 'offline' ? { opacity: 0.55 } : {}),
                        ...(clickable ? {} : { cursor: 'default' }),
                      }}
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={clickable ? () => void openContract(meta.contract) : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === 'Enter') void openContract(meta.contract)
                            }
                          : undefined
                      }
                    >
                      <div className="worker-kind">
                        <span className={`pill ${meta.kind === 'script' ? 'pill-sys' : 'pill-run'}`}>
                          {meta.kind === 'script' ? 'SCRIPT' : 'AGENT'}
                        </span>
                      </div>
                      <div className="worker-orb">{meta.orb}</div>
                      <div className="worker-name">{meta.name}</div>
                      <div className="worker-state">{status}</div>
                      <div className="worker-sub">
                        <strong>{meta.on}</strong>
                        {meta.kind === 'script'
                          ? 'deterministic fetch · no LLM'
                          : w?.lastEventType ?? (status === 'offline' ? 'worker offline' : 'waiting event')}
                      </div>
                      {meta.hasContract ? <div className="contract-hint">view contract</div> : null}
                    </div>
                  )
                })}
              </div>

              <div
                className="worker is-gate-wait"
                style={{ marginTop: 12, maxWidth: 280, cursor: 'pointer' }}
                role="button"
                tabIndex={0}
                onClick={() => setTab('approve')}
              >
                <div className="worker-orb">GATE</div>
                <div className="worker-name">human gate</div>
                <div className="worker-state">{problems.needsApprove.length} waiting</div>
                <div className="worker-sub">
                  <strong>proposed · non-high</strong>
                  await approve
                </div>
                <div className="contract-hint">open gate</div>
              </div>

              <div className="schedule">
                <span>
                  sync trigger: <em>manual only</em> · Web <em>SYNC NOW</em> / CLI
                </span>
                <span>no 30min auto scheduler in this version</span>
                <span>active invocations: {runningCount}</span>
                <span>followup-worker: {workerByLoop('followup')?.status ?? 'offline'}</span>
              </div>
            </div>

            <div className="stats">
              <div className="stat hero">
                <div className="label">Active loop invocations</div>
                <div className="value">{runningCount}</div>
                <div className="hint">当前正在跑的 loop worker 数</div>
              </div>
              <div className="stat">
                <div className="label">Gate · proposed</div>
                <div className="value">{stats?.pendingApproval ?? problems.needsApprove.length}</div>
                <div className="hint">仅 non-high</div>
              </div>
              <div className="stat">
                <div className="label">Fixing in pipeline</div>
                <div className="value">{stats?.fixingInPipeline ?? '—'}</div>
                <div className="hint">按 signal 去重</div>
              </div>
              <div className="stat">
                <div className="label">Verified awaiting close</div>
                <div className="value">{stats?.verifiedAwaitingClose ?? '—'}</div>
              </div>
            </div>

            <div className="grid-2">
              <div className="panel">
                <div className="panel-h">
                  <h3>EVENT STREAM</h3>
                  <span className="pill pill-run">live</span>
                </div>
                <div className="panel-b event-stream">
                  {events.length === 0 ? (
                    <p className="note" style={{ margin: 0 }}>
                      暂无事件
                    </p>
                  ) : (
                    events.slice(0, 14).map((e) => (
                      <div
                        key={e.id}
                        className={`event-line${e.type.includes('proposed') && e.payload.priority !== 'high' ? ' is-gate' : ''}${e === events[0] ? ' is-hot' : ''}`}
                      >
                        <span className="t">{fmtTime(e.at)}</span>
                        <span className="ev">{e.type}</span>
                        <span>{e.payload.summary ?? e.payload.taskId ?? e.payload.source ?? ''}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="panel">
                <div className="panel-h">
                  <h3>HOW TO READ</h3>
                </div>
                <div
                  className="panel-b"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    color: 'var(--muted)',
                    lineHeight: 1.75,
                  }}
                >
                  上方卡片 = loop worker（进程）
                  <br />
                  RUNNING = 本 loop 正在 invoke
                  <br />
                  IDLE = 等自己的订阅事件
                  <br />
                  GATE = 人机中断（非严重 proposed）
                  <br />
                  下方 = 事件总线时间线
                  <br />
                  Problems = signal / task 共享状态
                  <br />
                  <br />
                  不是「芯片在工位挪动」
                </div>
              </div>
            </div>

            <p className="note">
              事件驱动 · 一 loop 一 worker · <strong>sync 仅手动 SYNC NOW</strong> · high 自动
              task.approved · 其余进 Gate。
            </p>
          </section>
        ) : null}

        {tab === 'problems' ? (
          <section className="view is-on">
            <div className="theater">
              <div className="theater-head">
                <div>
                  <h2>PROBLEMS</h2>
                  <div className="meta">
                    看清两件事：哪些问题
                    <strong style={{ color: 'var(--amber)' }}>需要 Approve</strong>，哪些已经
                    <strong style={{ color: 'var(--mint)' }}>修复完成</strong>。
                  </div>
                </div>
              </div>
              <div className="problems-grid">
                <div className="panel">
                  <div className="panel-h">
                    <h3>NEEDS APPROVE</h3>
                    <span className="pill pill-wait">{problems.needsApprove.length}</span>
                  </div>
                  <div className="panel-b">
                    {problems.needsApprove.map((t) => (
                      <div key={t.id} className="problem-card">
                        <h4>{t.title}</h4>
                        <div className="row">
                          priority={t.priority} · status={t.status}
                        </div>
                        <div className="row">{t.id}</div>
                        <div style={{ marginTop: 10 }}>
                          <button className="btn btn-approve" type="button" onClick={() => void openGate(t)}>
                            REVIEW
                          </button>
                        </div>
                      </div>
                    ))}
                    {problems.needsApprove.length === 0 ? (
                      <p className="note" style={{ margin: 0 }}>
                        空 · high 不会出现在此列
                      </p>
                    ) : (
                      <p className="note" style={{ margin: '8px 0 0' }}>
                        high 不会出现在此列（系统已自动批准）。
                      </p>
                    )}
                  </div>
                </div>
                <div className="panel">
                  <div className="panel-h">
                    <h3>FIXED / READY TO CLOSE</h3>
                    <span className="pill pill-ok">{problems.fixed.length}</span>
                  </div>
                  <div className="panel-b">
                    {problems.fixed.map((t) => (
                      <div key={t.id} className="problem-card">
                        <h4>{t.title}</h4>
                        <div className="row">
                          status={t.status}
                          {t.branch ? ` · ${t.branch}` : ''}
                        </div>
                        <div className="row">
                          {t.approved_by ? `approved_by=${t.approved_by}` : t.id}
                        </div>
                      </div>
                    ))}
                    {problems.fixed.length === 0 ? (
                      <p className="note" style={{ margin: 0 }}>
                        空
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="panel" style={{ marginTop: 12 }}>
                <div className="panel-h">
                  <h3>IN FLIGHT</h3>
                  <span className="pill pill-run">{problems.inFlight.length}</span>
                </div>
                <div className="panel-b">
                  {problems.inFlight.map((t) => (
                    <div key={t.id} className="problem-card" style={{ margin: 0 }}>
                      <h4>{t.title}</h4>
                      <div className="row">
                        {t.status} · {t.id}
                      </div>
                    </div>
                  ))}
                  {problems.inFlight.length === 0 ? (
                    <p className="note" style={{ margin: 0 }}>
                      空
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {tab === 'contracts' ? (
          <section className="view is-on">
            <div className="theater">
              <div className="theater-head">
                <div>
                  <h2>LOOP CONTRACTS</h2>
                  <div className="meta">
                    来源 <code>domains/*/README.md</code>。只读展示。
                  </div>
                </div>
              </div>
              <div className="tabs-inline">
                {(contracts.length
                  ? contracts
                  : DISPLAY_LOOPS.map((l) => ({ loop: l, title: l, domainPath: '', excerpt: '' }))
                ).map((c) => (
                  <button
                    key={c.loop}
                    type="button"
                    className={contractKey === c.loop ? 'is-on' : ''}
                    onClick={() => setContractKey(c.loop)}
                  >
                    {c.loop}
                  </button>
                ))}
              </div>
              <div className="panel">
                <div className="panel-h">
                  <h3>{activeContract?.title ?? 'Contract'}</h3>
                  <span className="pill pill-run">{activeContract?.domainPath ?? '—'}</span>
                </div>
                <div
                  className="panel-b contract-body"
                  dangerouslySetInnerHTML={{
                    __html: renderContractHtml(activeContract?.body ?? activeContract?.excerpt ?? '加载中…'),
                  }}
                />
              </div>
            </div>
          </section>
        ) : null}

        {tab === 'events' ? (
          <section className="view is-on">
            <div className="theater">
              <div className="theater-head">
                <div>
                  <h2>EVENT / INVOCATION LOG</h2>
                  <div className="meta">每条事件 → 哪个 worker 可能消费 → 结果摘要。</div>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Payload</th>
                    <th>Hint</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td>{fmtTime(e.at)}</td>
                      <td>{e.type}</td>
                      <td>{e.payload.summary ?? e.payload.taskId ?? e.payload.source ?? '—'}</td>
                      <td>
                        <span className="pill pill-run">{e.payload.priority ?? 'event'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {events.length === 0 ? <p className="note">暂无事件</p> : null}
            </div>
          </section>
        ) : null}

        {tab === 'approve' ? (
          <section className="view is-on">
            <div className="panel">
              <div className="panel-h">
                <h3>HUMAN GATE · NON-HIGH ONLY</h3>
              </div>
              <div className="panel-b">
                <p className="note" style={{ marginTop: 0 }}>
                  与 Problems「Needs Approve」同源；此处专注审批操作。
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Priority</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {problems.needsApprove.map((t) => (
                      <tr key={t.id}>
                        <td>{t.title}</td>
                        <td>
                          <span className="pill pill-wait">{t.priority}</span>
                        </td>
                        <td>
                          <button className="btn btn-approve" type="button" onClick={() => void openGate(t)}>
                            REVIEW
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {problems.needsApprove.length === 0 ? (
                  <p className="note">暂无待批准</p>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}
      </div>

      <div
        className={`drawer-mask${gateTask ? ' is-open' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setGateTask(null)
        }}
      >
        {gateTask ? (
          <aside className="drawer">
            <h3>{gateTask.title}</h3>
            <div className="meta">
              priority={gateTask.priority} · status={gateTask.status} · {gateTask.id}
            </div>
            {gateTask.body ? (
              <div className="block">
                <h4>Task body</h4>
                <p style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{gateTask.body.slice(0, 1200)}</p>
              </div>
            ) : null}
            <div className="block">
              <h4>After approve</h4>
              <p>
                publish <code>task.approved</code> → coding-worker 订阅并 invoke coding-loop。
              </p>
            </div>
            <div className="drawer-actions">
              <button className="btn btn-approve" type="button" disabled={busy} onClick={() => void doApprove()}>
                APPROVE → EVENT
              </button>
              <button className="btn btn-reject" type="button" disabled={busy} onClick={() => void doReject()}>
                REJECT
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setGateTask(null)}>
                CLOSE
              </button>
            </div>
          </aside>
        ) : null}
      </div>

      <div
        className={`drawer-mask${contractDrawer ? ' is-open' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setContractDrawer(null)
        }}
      >
        {contractDrawer ? (
          <aside className="drawer">
            <h3>{contractDrawer.title}</h3>
            <div className="meta">{contractDrawer.domainPath}</div>
            <div
              className="contract-body"
              dangerouslySetInnerHTML={{
                __html: renderContractHtml(contractDrawer.body ?? contractDrawer.excerpt),
              }}
            />
            <div className="drawer-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setContractDrawer(null)}>
                CLOSE
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setContractKey(contractDrawer.loop)
                  setContractDrawer(null)
                  setTab('contracts')
                }}
              >
                OPEN CONTRACTS TAB
              </button>
            </div>
          </aside>
        ) : null}
      </div>
    </>
  )
}
