export type FeedbackType = 'bug' | 'feature' | 'question' | 'other'
export type FeedbackStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type LoopStatus = 'pending' | 'processed' | 'skipped'

export type FeedbackFrontmatter = {
  id: string
  type: FeedbackType
  status: FeedbackStatus
  /** 来源标识；由 LOOP_FEEDBACK_SOURCE 写入，默认可为 site_feedback */
  source: string
  user_id: string | null
  user_email: string | null
  contact: string | null
  loop_status: LoopStatus
  signal_id: string | null
  created_at: string
  updated_at: string
  synced_at: string
}

export type FeedbackArtifact = {
  path: string
  data: FeedbackFrontmatter
  content: string
}

export type SignalStatus =
  | 'active'
  | 'task_created'
  | 'fixing'
  | 'verified'
  | 'closed'
  | 'wontfix'

export type SignalPriority = 'low' | 'medium' | 'high'

export type SignalFrontmatter = {
  id: string
  title: string
  type: 'bug'
  status: SignalStatus
  priority: SignalPriority
  occurrences: number
  ready_for_task: boolean
  sources: string[]
  keywords: string[]
  task_id: string | null
  created_at: string
  updated_at: string
}

export type SignalArtifact = {
  path: string
  data: SignalFrontmatter
  body: string
}

export type TaskStatus =
  | 'proposed'
  | 'approved'
  | 'in_progress'
  | 'implemented'
  | 'verified'
  | 'failed'
  | 'closed'

export type TaskFrontmatter = {
  id: string
  title: string
  status: TaskStatus
  source_signal: string
  priority: SignalPriority
  owner_loop: 'coding'
  repos: string[]
  branch: string | null
  created_at: string
  approved_at: string | null
  approved_by?: string | null
  rejected_at?: string | null
  reject_note?: string | null
}

export type TaskArtifact = {
  path: string
  data: TaskFrontmatter
  body: string
}

/** Admin API 返回的反馈条目（camelCase） */
export type AdminFeedbackDto = {
  id: string
  userId: string
  type: FeedbackType
  content: string
  contact: string | null
  status: FeedbackStatus
  adminNote: string | null
  createdAt: string
  updatedAt: string
  userEmail: string | null
  userNickname: string | null
}

export type AdminFeedbackListResponse = {
  ok: boolean
  feedback: AdminFeedbackDto[]
  page: number
  pageSize: number
  total: number
  error?: string
}

export type SyncState = {
  lastSyncedAt: string | null
  lastCounts: {
    open: number
    in_progress: number
    written: number
    updated: number
  }
}
