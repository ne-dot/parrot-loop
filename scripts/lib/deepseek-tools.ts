import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { LOOP_ROOT } from './env.js'

export type ToolResult = { ok: boolean; content: string }

function resolveSafePath(workspace: string, relOrAbs: string): string {
  const abs = path.isAbsolute(relOrAbs) ? relOrAbs : path.resolve(workspace, relOrAbs)
  const root = path.resolve(workspace)
  const normalized = path.resolve(abs)
  if (normalized !== root && !normalized.startsWith(root + path.sep)) {
    throw new Error(`路径越界：${relOrAbs}（必须在 workspace 内）`)
  }
  return normalized
}

export const DEEPSEEK_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_dir',
      description: '列出目录下的文件与子目录（不含 node_modules/.git）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对 workspace 的路径，默认 .' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: '读取文本文件全文',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对 workspace 的文件路径' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description: '写入/覆盖文本文件（自动创建父目录）',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对 workspace 的文件路径' },
          content: { type: 'string', description: '完整文件内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_shell',
      description:
        '在 workspace 内执行只读或轻量命令（ls/rg/git status/git diff/git log/head/cat）。禁止 push/merge/rm -rf。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '单行 shell 命令' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'done',
      description: '本轮任务完成时调用，附简短中文摘要',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
        },
        required: ['summary'],
      },
    },
  },
]

const SHELL_DENY =
  /\b(rm\s+-rf|git\s+push|git\s+merge|git\s+rebase|curl\s+|wget\s+|ssh\s+|sudo\b|chmod\s+|chown\s+|dd\s+|mkfs|npm\s+publish|docker\s+)\b/i

export function runDeepseekTool(
  workspace: string,
  name: string,
  argsJson: string,
): ToolResult & { done?: boolean; summary?: string } {
  let args: Record<string, unknown> = {}
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {}
  } catch {
    return { ok: false, content: `无效 JSON 参数: ${argsJson}` }
  }

  try {
    switch (name) {
      case 'list_dir': {
        const rel = String(args.path ?? '.')
        const dir = resolveSafePath(workspace, rel)
        if (!existsSync(dir) || !statSync(dir).isDirectory()) {
          return { ok: false, content: `不是目录: ${rel}` }
        }
        const entries = readdirSync(dir)
          .filter((n) => n !== 'node_modules' && n !== '.git' && n !== 'dist')
          .sort()
          .map((n) => {
            const full = path.join(dir, n)
            const st = statSync(full)
            return `${st.isDirectory() ? 'dir' : 'file'}\t${n}`
          })
        return { ok: true, content: entries.join('\n') || '(empty)' }
      }
      case 'read_file': {
        const rel = String(args.path ?? '')
        const file = resolveSafePath(workspace, rel)
        if (!existsSync(file)) return { ok: false, content: `文件不存在: ${rel}` }
        const raw = readFileSync(file, 'utf8')
        if (raw.length > 200_000) {
          return { ok: true, content: `${raw.slice(0, 200_000)}\n\n…(truncated)` }
        }
        return { ok: true, content: raw }
      }
      case 'write_file': {
        const rel = String(args.path ?? '')
        const content = String(args.content ?? '')
        const file = resolveSafePath(workspace, rel)
        // 禁止写 .env
        if (path.basename(file) === '.env' || file.endsWith(`${path.sep}.env`)) {
          return { ok: false, content: '禁止写入 .env' }
        }
        mkdirSync(path.dirname(file), { recursive: true })
        writeFileSync(file, content, 'utf8')
        return { ok: true, content: `wrote ${rel} (${content.length} chars)` }
      }
      case 'run_shell': {
        const command = String(args.command ?? '').trim()
        if (!command) return { ok: false, content: '空命令' }
        if (SHELL_DENY.test(command)) {
          return { ok: false, content: `命令被拒绝（安全策略）: ${command}` }
        }
        const result = spawnSync(command, {
          cwd: workspace,
          shell: true,
          encoding: 'utf8',
          timeout: 60_000,
          env: process.env,
        })
        const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
        const code = result.status ?? 1
        return {
          ok: code === 0,
          content: out ? `${out}\n(exit ${code})` : `(exit ${code})`,
        }
      }
      case 'done': {
        return {
          ok: true,
          content: 'ok',
          done: true,
          summary: String(args.summary ?? 'done'),
        }
      }
      default:
        return { ok: false, content: `未知工具: ${name}` }
    }
  } catch (err) {
    return { ok: false, content: err instanceof Error ? err.message : String(err) }
  }
}

/** 默认 DeepSeek workspace：loop-engineer 根（读写 artifacts） */
export function defaultDeepseekWorkspace(): string {
  return LOOP_ROOT
}
