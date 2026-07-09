import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

export const LOOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

loadEnv({ path: path.join(LOOP_ROOT, '.env') })

export const PATHS = {
  root: LOOP_ROOT,
  artifacts: path.join(LOOP_ROOT, 'artifacts'),
  feedback: path.join(LOOP_ROOT, 'artifacts', 'feedback'),
  signals: path.join(LOOP_ROOT, 'artifacts', 'signals'),
  tasks: path.join(LOOP_ROOT, 'artifacts', 'tasks'),
  verifications: path.join(LOOP_ROOT, 'artifacts', 'verifications'),
  followups: path.join(LOOP_ROOT, 'artifacts', 'followups'),
  domains: path.join(LOOP_ROOT, 'domains'),
  state: path.join(LOOP_ROOT, 'state'),
  syncState: path.join(LOOP_ROOT, 'state', 'sync-state.json'),
  log: path.join(LOOP_ROOT, 'log.md'),
} as const

export type AgentRuntime = 'cursor' | 'deepseek'

export type LoopEnv = {
  apiBaseUrl: string
  adminCookie: string
  autoApprove: boolean
  /** Cursor agent 可执行文件；默认 `agent`（仅 coding） */
  agentBin: string
  agentModel: string | null
  workspaceRoot: string
  /** 非 coding loop 默认 runtime */
  defaultRuntime: AgentRuntime
  deepseekApiKey: string | null
  deepseekBaseUrl: string
  deepseekModel: string
  deepseekMaxRounds: number
}

export function getEnv(): LoopEnv {
  const apiBaseUrl = (process.env.LOOP_API_BASE_URL ?? 'http://localhost:4001').replace(/\/$/, '')
  const adminCookie = (process.env.LOOP_ADMIN_COOKIE ?? '').trim()
  const autoApprove = process.env.LOOP_AUTO_APPROVE === 'true'
  const agentBin = process.env.LOOP_AGENT_BIN?.trim() || 'agent'
  const agentModel = process.env.LOOP_AGENT_MODEL?.trim() || null
  const workspaceRoot =
    process.env.LOOP_WORKSPACE_ROOT?.trim() || path.resolve(LOOP_ROOT, '..')
  const defaultRuntime: AgentRuntime =
    process.env.LOOP_DEFAULT_RUNTIME === 'cursor' ? 'cursor' : 'deepseek'
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY?.trim() || null
  const deepseekBaseUrl = (
    process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com'
  ).replace(/\/$/, '')
  const deepseekModel = process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat'
  const deepseekMaxRounds = Number(process.env.DEEPSEEK_MAX_ROUNDS ?? 12)

  return {
    apiBaseUrl,
    adminCookie,
    autoApprove,
    agentBin,
    agentModel,
    workspaceRoot,
    defaultRuntime,
    deepseekApiKey,
    deepseekBaseUrl,
    deepseekModel,
    deepseekMaxRounds: Number.isFinite(deepseekMaxRounds) && deepseekMaxRounds > 0 ? deepseekMaxRounds : 12,
  }
}
