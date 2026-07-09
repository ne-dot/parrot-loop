import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

function parseScalar(raw: string): unknown {
  const v = raw.trim()
  if (v === 'null' || v === '~') return null
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1)
  }
  return v
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    if (value === '' || /[:#\[\]{},&*?|>!%@`]/.test(value) || /^\s|\s$/.test(value)) {
      return JSON.stringify(value)
    }
    return value
  }
  return JSON.stringify(value)
}

/** 解析简单 YAML frontmatter（标量 + 字符串数组） */
export function parseFrontmatter<T extends Record<string, unknown>>(
  raw: string,
): { data: T; body: string } {
  const match = FRONTMATTER_RE.exec(raw)
  if (!match) {
    return { data: {} as T, body: raw }
  }

  const yaml = match[1]!
  const body = match[2]!.replace(/^\r?\n/, '')
  const data: Record<string, unknown> = {}
  const lines = yaml.split(/\r?\n/)
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim() || line.trimStart().startsWith('#')) {
      i += 1
      continue
    }

    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line)
    if (!kv) {
      i += 1
      continue
    }

    const key = kv[1]!
    const rest = kv[2]!.trim()

    if (rest === '' || rest === '|' || rest === '>') {
      const items: string[] = []
      i += 1
      while (i < lines.length) {
        const item = /^\s+-\s+(.*)$/.exec(lines[i]!)
        if (!item) break
        items.push(String(parseScalar(item[1]!)))
        i += 1
      }
      data[key] = items
      continue
    }

    if (rest === '[]') {
      data[key] = []
      i += 1
      continue
    }

    data[key] = parseScalar(rest)
    i += 1
  }

  return { data: data as T, body }
}

export function stringifyFrontmatter(
  data: Record<string, unknown>,
  body: string,
): string {
  const lines: string[] = ['---']
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`)
      if (value.length === 0) {
        lines.push('  []')
      } else {
        for (const item of value) {
          lines.push(`  - ${formatScalar(item)}`)
        }
      }
    } else {
      lines.push(`${key}: ${formatScalar(value)}`)
    }
  }
  lines.push('---', '')
  const normalizedBody = body.replace(/^\n+/, '').replace(/\n*$/, '\n')
  return `${lines.join('\n')}${normalizedBody}`
}

export function readMarkdownFile<T extends Record<string, unknown>>(
  filePath: string,
): { data: T; body: string } {
  const raw = readFileSync(filePath, 'utf8')
  return parseFrontmatter<T>(raw)
}

export function writeMarkdownFile(
  filePath: string,
  data: Record<string, unknown>,
  body: string,
): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, stringifyFrontmatter(data, body), 'utf8')
}

export function listMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(dir, name))
    .sort()
}
