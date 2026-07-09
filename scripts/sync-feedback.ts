import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getEnv, PATHS } from './lib/env.js'
import { appendLog } from './lib/log.js'
import { listMarkdownFiles, readMarkdownFile, writeMarkdownFile } from './lib/md.js'
import type {
  AdminFeedbackDto,
  AdminFeedbackListResponse,
  FeedbackFrontmatter,
  SyncState,
} from './lib/types.js'

const PAGE_SIZE = 100
const STATUSES = ['open', 'in_progress'] as const

function feedbackPath(id: string): string {
  return path.join(PATHS.feedback, `feedback-${id}.md`)
}

class AuthError extends Error {
  constructor(public status: number) {
    super(`Admin API 鉴权失败 (${status})。请【人工】重配 LOOP_ADMIN_COOKIE`)
    this.name = 'AuthError'
  }
}

async function fetchPage(
  baseUrl: string,
  cookie: string,
  status: string,
  page: number,
): Promise<AdminFeedbackListResponse> {
  const url = new URL('/api/admin/feedback', baseUrl)
  url.searchParams.set('type', 'bug')
  url.searchParams.set('status', status)
  url.searchParams.set('page', String(page))
  url.searchParams.set('pageSize', String(PAGE_SIZE))

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Cookie: cookie,
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
  baseUrl: string,
  cookie: string,
): Promise<{ items: AdminFeedbackDto[]; counts: Record<(typeof STATUSES)[number], number> }> {
  const byId = new Map<string, AdminFeedbackDto>()
  const counts = { open: 0, in_progress: 0 }

  for (const status of STATUSES) {
    let page = 1
    let total = Infinity
    while ((page - 1) * PAGE_SIZE < total) {
      const data = await fetchPage(baseUrl, cookie, status, page)
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
): { data: FeedbackFrontmatter; body: string } {
  const data: FeedbackFrontmatter = {
    id: dto.id,
    type: dto.type,
    status: dto.status,
    source: 'site_feedback',
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
  if (!env.adminCookie || /^parrot_admin_auth_token=\s*$/.test(env.adminCookie)) {
    console.error('loop-engineer sync: LOOP_ADMIN_COOKIE 未配置或为空')
    console.error('请【人工】从 Admin 浏览器复制 Cookie 写入 loop-engineer/.env')
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
    const { items, counts } = await fetchAllBugs(env.apiBaseUrl, env.adminCookie)
    let written = 0
    let updated = 0

    for (const item of items) {
      if (item.type !== 'bug') continue
      const existing = loadExisting(item.id)
      const { data, body } = toArtifact(item, existing, syncedAt)
      const file = feedbackPath(item.id)
      const isNew = !existsSync(file)
      writeMarkdownFile(file, data as unknown as Record<string, unknown>, body)
      if (isNew) written += 1
      else updated += 1
    }

    saveSyncState({
      lastSyncedAt: syncedAt,
      lastCounts: {
        open: counts.open,
        in_progress: counts.in_progress,
        written,
        updated,
      },
    })

    const summary = `同步 bug 反馈 ${items.length} 条（新建 ${written}，更新 ${updated}）；API open=${counts.open} in_progress=${counts.in_progress}`
    console.log(`loop-engineer sync: ${summary}`)
    appendLog({
      loop: 'sync-feedback',
      status: 'ok',
      summary,
      details: [
        `api=${env.apiBaseUrl}`,
        `artifacts=${PATHS.feedback}`,
        `本地 feedback 文件=${listMarkdownFiles(PATHS.feedback).length}`,
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
