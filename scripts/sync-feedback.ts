import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getEnv, isAdminCookieConfigured, PATHS, type LoopEnv } from './lib/env.js'
import { appendLog } from './lib/log.js'
import { listMarkdownFiles, readMarkdownFile, writeMarkdownFile } from './lib/md.js'
import type {
  AdminFeedbackDto,
  AdminFeedbackListResponse,
  FeedbackFrontmatter,
  SyncState,
} from './lib/types.js'
import { assertSyncResult, formatAssertFailure } from './lib/verify-artifacts.js'

const PAGE_SIZE = 100

function feedbackPath(id: string): string {
  return path.join(PATHS.feedback, `feedback-${id}.md`)
}

class AuthError extends Error {
  constructor(public status: number) {
    super(`Feedback API 鉴权失败 (${status})。请【人工】重配 LOOP_ADMIN_COOKIE`)
    this.name = 'AuthError'
  }
}

function normalizeListPath(listPath: string): string {
  return listPath.startsWith('/') ? listPath : `/${listPath}`
}

async function fetchPage(
  env: LoopEnv,
  status: string,
  page: number,
): Promise<AdminFeedbackListResponse> {
  const url = new URL(normalizeListPath(env.feedbackListPath), `${env.apiBaseUrl}/`)
  url.searchParams.set('type', env.feedbackType)
  url.searchParams.set('status', status)
  url.searchParams.set('page', String(page))
  url.searchParams.set('pageSize', String(PAGE_SIZE))

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Cookie: env.adminCookie,
    },
  })

  if (res.status === 401 || res.status === 403) {
    throw new AuthError(res.status)
  }

  const json = (await res.json()) as AdminFeedbackListResponse
  if (!res.ok || !json.ok) {
    throw new Error(`API ${res.status}: ${json.error ?? res.statusText}`)
  }
  return json
}

async function fetchAllBugs(
  env: LoopEnv,
): Promise<{ items: AdminFeedbackDto[]; counts: Record<string, number> }> {
  const byId = new Map<string, AdminFeedbackDto>()
  const counts: Record<string, number> = {}

  for (const status of env.feedbackStatuses) {
    let page = 1
    let total = Infinity
    counts[status] = 0
    while ((page - 1) * PAGE_SIZE < total) {
      const data = await fetchPage(env, status, page)
      total = data.total
      counts[status] = data.total
      for (const item of data.feedback) {
        byId.set(item.id, item)
      }
      if (data.feedback.length === 0) break
      page += 1
    }
  }

  return { items: [...byId.values()], counts }
}

function extractContent(body: string): string {
  return body.replace(/^##\s*Content\s*/i, '').trim()
}

function toArtifact(
  dto: AdminFeedbackDto,
  existing: FeedbackFrontmatter | null,
  syncedAt: string,
  source: string,
): { data: FeedbackFrontmatter; body: string } {
  const data: FeedbackFrontmatter = {
    id: dto.id,
    type: dto.type,
    status: dto.status,
    source,
    user_id: dto.userId,
    user_email: dto.userEmail,
    contact: dto.contact,
    loop_status: existing?.loop_status ?? 'pending',
    signal_id: existing?.signal_id ?? null,
    created_at: dto.createdAt,
    updated_at: dto.updatedAt,
    synced_at: syncedAt,
  }

  const body = `## Content\n\n${dto.content.trim()}\n`
  if (existing && existing.loop_status === 'processed' && existsSync(feedbackPath(dto.id))) {
    const prev = readMarkdownFile<FeedbackFrontmatter>(feedbackPath(dto.id))
    if (extractContent(prev.body).trim() !== dto.content.trim()) {
      data.loop_status = 'pending'
      data.signal_id = null
    }
  }

  return { data, body }
}

function saveSyncState(state: SyncState): void {
  mkdirSync(PATHS.state, { recursive: true })
  writeFileSync(PATHS.syncState, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function loadExisting(id: string): FeedbackFrontmatter | null {
  const file = feedbackPath(id)
  if (!existsSync(file)) return null
  return readMarkdownFile<FeedbackFrontmatter>(file).data
}

export async function runSyncFeedback(): Promise<number> {
  const env = getEnv()
  if (!isAdminCookieConfigured(env)) {
    console.error('loop-engineer sync: LOOP_ADMIN_COOKIE 未配置或为空')
    console.error(
      `请【人工】写入 Cookie（格式 ${env.adminCookieName}=…），或手动放置 artifacts/feedback/*.md 后跳过 sync`,
    )
    appendLog({
      loop: 'sync-feedback',
      status: 'failed',
      summary: '缺少 LOOP_ADMIN_COOKIE',
    })
    return 1
  }

  mkdirSync(PATHS.feedback, { recursive: true })
  const syncedAt = new Date().toISOString()

  try {
    const { items, counts } = await fetchAllBugs(env)
    let written = 0
    let updated = 0

    for (const item of items) {
      if (item.type !== env.feedbackType) continue

      const existing = loadExisting(item.id)
      const { data, body } = toArtifact(item, existing, syncedAt, env.feedbackSource)
      const file = feedbackPath(item.id)
      const isNew = !existsSync(file)
      writeMarkdownFile(file, data as unknown as Record<string, unknown>, body)
      if (isNew) written += 1
      else updated += 1
    }

    saveSyncState({
      lastSyncedAt: syncedAt,
      lastCounts: {
        open: counts.open ?? 0,
        in_progress: counts.in_progress ?? 0,
        written,
        updated,
      },
    })

    const statusSummary = env.feedbackStatuses.map((s) => `${s}=${counts[s] ?? 0}`).join(' ')
    const summary = `同步反馈 ${items.length} 条（新建 ${written}，更新 ${updated}）；API ${statusSummary}`
    console.log(`loop-engineer sync: ${summary}`)

    const check = assertSyncResult({ fetched: items.length, written, updated })
    if (!check.ok) {
      console.error(`loop-engineer sync Verify: ${formatAssertFailure(check)}`)
      appendLog({
        loop: 'sync-feedback',
        status: 'failed',
        summary: formatAssertFailure(check),
      })
      return 1
    }

    appendLog({
      loop: 'sync-feedback',
      status: 'ok',
      summary,
      details: [
        `api=${env.apiBaseUrl}${normalizeListPath(env.feedbackListPath)}`,
        `artifacts=${PATHS.feedback}`,
        `本地 feedback 文件=${listMarkdownFiles(PATHS.feedback).length}`,
        check.summary,
      ],
    })
    return 0
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loop-engineer sync: ${message}`)
    appendLog({
      loop: 'sync-feedback',
      status: 'failed',
      summary: message,
    })
    return 1
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  runSyncFeedback().then((code) => process.exit(code))
}
