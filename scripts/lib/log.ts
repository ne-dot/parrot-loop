import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { PATHS } from './env.js'

function stamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export type LogStatus = 'ok' | 'failed' | 'skipped' | 'info'

/** 追加一条运行日志到 log.md */
export function appendLog(opts: {
  loop: string
  status: LogStatus
  summary: string
  details?: string[]
}): void {
  const lines = [
    '',
    `## ${stamp()} — ${opts.loop}`,
    '',
    `- status: \`${opts.status}\``,
    `- ${opts.summary}`,
  ]
  if (opts.details?.length) {
    for (const d of opts.details) {
      lines.push(`  - ${d}`)
    }
  }
  lines.push('')

  if (!existsSync(PATHS.log)) {
    writeFileSync(
      PATHS.log,
      '# Loop Engineer 运行日志\n\n> 各脚本【人工】触发后追加本文件。\n',
      'utf8',
    )
  }
  appendFileSync(PATHS.log, lines.join('\n'), 'utf8')
}

export function readLogTail(maxChars = 2000): string {
  if (!existsSync(PATHS.log)) return ''
  const raw = readFileSync(PATHS.log, 'utf8')
  return raw.length <= maxChars ? raw : raw.slice(-maxChars)
}
