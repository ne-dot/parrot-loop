/**
 * Loop Engineer 自定义 CLI
 *
 * 用法：
 *   loop-engineer --help
 *   loop-engineer <command> [options]
 *
 * 【人工】触发；不做常驻服务 / 全自动 cron。
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ path: path.join(root, '.env') })

const require = createRequire(import.meta.url)
const tsxCli = require.resolve('tsx/cli')

type CommandDef = {
  script: string
  summary: string
  stage: string
  gate?: string
}

const COMMANDS: Record<string, CommandDef> = {
  hello: {
    script: 'hello.ts',
    summary: '自检：tsx / 骨架是否可用',
    stage: '1',
  },
  sync: {
    script: 'sync-feedback.ts',
    summary: '从 Admin API 同步 bug 反馈 → artifacts/feedback',
    stage: '2',
  },
  feedback: {
    script: 'feedback-loop.ts',
    summary: '【DeepSeek】归类 pending 反馈 → signals',
    stage: '2',
  },
  task: {
    script: 'task-loop.ts',
    summary: '【DeepSeek】达阈值后生成 status=proposed 的 task',
    stage: '3',
  },
  'run-to-task': {
    script: 'run-to-task.ts',
    summary: 'sync(脚本) → feedback(DeepSeek) → task(DeepSeek)',
    stage: '3',
  },
  coding: {
    script: 'coding-loop.ts',
    summary: '【Cursor】修复（须 task 已 approved）',
    stage: '4',
    gate: 'task.status === approved',
  },
  verify: {
    script: 'verifier-loop.ts',
    summary: '【DeepSeek】对照 Acceptance 写验证报告',
    stage: '4',
  },
  followup: {
    script: 'followup-loop.ts',
    summary: '【DeepSeek】回访草稿（永不自动发信）',
    stage: '5',
    gate: '仅草稿；【人工】发送',
  },
}

const ALIASES: Record<string, string> = {
  'to-task': 'run-to-task',
  verifier: 'verify',
  'feedback-loop': 'feedback',
  'task-loop': 'task',
  'coding-loop': 'coding',
  'followup-loop': 'followup',
  'sync-feedback': 'sync',
}

function printHelp(): void {
  const lines = [
    'loop-engineer — Parrot Factory Loop Engineer CLI',
    '',
    '用法:',
    '  loop-engineer <command> [args...]',
    '  loop-engineer --help',
    '',
    '命令:',
  ]

  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length))
  for (const [name, def] of Object.entries(COMMANDS)) {
    const pad = ' '.repeat(width - name.length)
    lines.push(`  ${name}${pad}  ${def.summary}  (阶段 ${def.stage})`)
    if (def.gate) {
      lines.push(`  ${' '.repeat(width)}  门禁: ${def.gate}`)
    }
  }

  lines.push(
    '',
    '别名: to-task → run-to-task；verifier → verify；*-loop → 短名',
    '',
    '推荐流（【人工】逐步触发）:',
    '  loop-engineer run-to-task',
    '  # 编辑 artifacts/tasks/*.md → status: approved',
    '  loop-engineer coding --task task-xxx',
    '  loop-engineer verify --task task-xxx',
    '  loop-engineer followup --task task-xxx',
    '',
    '安装到 PATH（本机一次）: cd loop-engineer && npm link',
    '全局硬边界: 不自动批准 / 不合入 main / 不部署 / 不发信',
    '合同: domains/*/README.md',
  )

  console.log(lines.join('\n'))
}

function printVersion(): void {
  const pkg = require(path.join(root, 'package.json')) as { version: string }
  console.log(`loop-engineer ${pkg.version}`)
}

function resolveCommand(raw: string | undefined): string | null {
  if (!raw) return null
  if (raw in COMMANDS) return raw
  if (raw in ALIASES) return ALIASES[raw]!
  return null
}

function runScript(script: string, args: string[]): number {
  const scriptPath = path.join(root, 'scripts', script)
  const result = spawnSync(process.execPath, [tsxCli, scriptPath, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.error) {
    console.error(`loop-engineer: failed to start ${script}:`, result.error.message)
    return 1
  }
  return result.status ?? 1
}

const argv = process.argv.slice(2)
const head = argv[0]

if (!head || head === '-h' || head === '--help' || head === 'help') {
  printHelp()
  process.exit(0)
}

if (head === '-V' || head === '--version' || head === 'version') {
  printVersion()
  process.exit(0)
}

const command = resolveCommand(head)
if (!command) {
  console.error(`loop-engineer: unknown command "${head}"`)
  console.error('运行 loop-engineer --help 查看可用命令')
  process.exit(1)
}

const def = COMMANDS[command]!
const exitCode = runScript(def.script, argv.slice(1))
process.exit(exitCode)
