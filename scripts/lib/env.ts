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
  /** Feedback HTTP API 基址（不含 path） */
  apiBaseUrl: string
  /** 列表接口 path，如 `/api/admin/feedback` */
  feedbackListPath: string
  /** 拉取的反馈 type 查询参数 */
  feedbackType: string
  /** 拉取的 status 列表 */
  feedbackStatuses: string[]
  /** 写入工件的 source 字段 */
  feedbackSource: string
  /** Cookie 头整串，如 `auth_token=eyJ...` */
  adminCookie: string
  /** Cookie 名（用于空值检测与文档提示） */
  adminCookieName: string
  autoApprove: boolean
  /** Cursor agent 可执行文件；默认 `agent`（仅 coding） */
  agentBin: string
  agentModel: string | null
  workspaceRoot: string
  /** task.repos 为空时的 fallback */
  defaultRepos: string[]
  /** verifier git diff 基准分支 */
  defaultBranch: string
  /** 非 coding loop 默认 runtime */
  defaultRuntime: AgentRuntime
  deepseekApiKey: string | null
  deepseekBaseUrl: string
  deepseekModel: string
  deepseekMaxRounds: number
  /** followup 草稿签名落款 */
  followupSignOff: string
}

function parseCsv(raw: string | undefined, fallback: string[]): string[] {
  if (!raw?.trim()) return fallback
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function getEnv(): LoopEnv {
  const apiBaseUrl = (process.env.LOOP_API_BASE_URL ?? 'http://localhost:4001').replace(/\/$/, '')
  const feedbackListPath = (process.env.LOOP_FEEDBACK_LIST_PATH ?? '/api/admin/feedback').trim() ||
    '/api/admin/feedback'
  const feedbackType = (process.env.LOOP_FEEDBACK_TYPE ?? 'bug').trim() || 'bug'
  const feedbackStatuses = parseCsv(process.env.LOOP_FEEDBACK_STATUSES, ['open', 'in_progress'])
  const feedbackSource = (process.env.LOOP_FEEDBACK_SOURCE ?? 'site_feedback').trim() || 'site_feedback'
  const adminCookieName =
    (process.env.LOOP_ADMIN_COOKIE_NAME ?? 'auth_token').trim() || 'auth_token'
  const adminCookie = (process.env.LOOP_ADMIN_COOKIE ?? '').trim()
  const autoApprove = process.env.LOOP_AUTO_APPROVE === 'true'
  const agentBin = process.env.LOOP_AGENT_BIN?.trim() || 'agent'
  const agentModel = process.env.LOOP_AGENT_MODEL?.trim() || null
  const workspaceRoot =
    process.env.LOOP_WORKSPACE_ROOT?.trim() || path.resolve(LOOP_ROOT, '..')
  const defaultRepos = parseCsv(process.env.LOOP_DEFAULT_REPOS, ['.'])
  const defaultBranch = (process.env.LOOP_DEFAULT_BRANCH ?? 'main').trim() || 'main'
  const defaultRuntime: AgentRuntime =
    process.env.LOOP_DEFAULT_RUNTIME === 'cursor' ? 'cursor' : 'deepseek'
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY?.trim() || null
  const deepseekBaseUrl = (
    process.env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com'
  ).replace(/\/$/, '')
  const deepseekModel = process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat'
  const deepseekMaxRounds = Number(process.env.DEEPSEEK_MAX_ROUNDS ?? 12)
  const followupSignOff =
    (process.env.LOOP_FOLLOWUP_SIGN_OFF ?? '—— Loop Engineer').trim() || '—— Loop Engineer'

  return {
    apiBaseUrl,
    feedbackListPath,
    feedbackType,
    feedbackStatuses,
    feedbackSource,
    adminCookie,
    adminCookieName,
    autoApprove,
    agentBin,
    agentModel,
    workspaceRoot,
    defaultRepos,
    defaultBranch,
    defaultRuntime,
    deepseekApiKey,
    deepseekBaseUrl,
    deepseekModel,
    deepseekMaxRounds: Number.isFinite(deepseekMaxRounds) && deepseekMaxRounds > 0 ? deepseekMaxRounds : 12,
    followupSignOff,
  }
}

/** Cookie 是否已配置有效值（非空 name=value） */
export function isAdminCookieConfigured(env: LoopEnv = getEnv()): boolean {
  const cookie = env.adminCookie
  if (!cookie) return false
  const eq = cookie.indexOf('=')
  if (eq === -1) return cookie.length > 0
  return cookie.slice(eq + 1).trim().length > 0
}
