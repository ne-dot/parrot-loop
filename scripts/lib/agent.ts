import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { DEEPSEEK_TOOLS, runDeepseekTool } from './deepseek-tools.js'
import { LOOP_ROOT, getEnv, type AgentRuntime } from './env.js'
import { appendLog } from './log.js'

export type AgentRunOptions = {
  /** loop 名，用于 log */
  loop: string
  /** 完整 prompt（含合同路径与任务） */
  prompt: string
  /** agent 工作目录 */
  workspace?: string
  /** 额外 CLI 参数（仅 cursor） */
  extraArgs?: string[]
  /** dry-run：只打印 prompt，不调用 agent */
  dryRun?: boolean
  /**
   * 执行器：
   * - cursor：本机 Cursor Agent CLI（可改业务代码）
   * - deepseek：DeepSeek Chat + 工具（读写 loop-engineer 工件）
   * 默认：coding → cursor；其余 → LOOP_DEFAULT_RUNTIME（deepseek）
   */
  runtime?: AgentRuntime
}

function resolveAgentBin(): string {
  const fromEnv = process.env.LOOP_AGENT_BIN?.trim()
  if (fromEnv) return fromEnv
  const candidates = [
    'agent',
    path.join(process.env.HOME ?? '', '.local/bin/agent'),
    '/usr/local/bin/agent',
  ]
  for (const c of candidates) {
    if (c === 'agent') return c
    if (existsSync(c)) return c
  }
  return 'agent'
}

function resolveRuntime(loop: string, explicit?: AgentRuntime): AgentRuntime {
  if (explicit) return explicit
  if (loop.includes('coding')) return 'cursor'
  return getEnv().defaultRuntime
}

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

type ChatResponse = {
  choices?: Array<{
    message?: ChatMessage
    finish_reason?: string
  }>
  error?: { message?: string }
}

async function deepseekChat(
  messages: ChatMessage[],
): Promise<ChatMessage> {
  const env = getEnv()
  if (!env.deepseekApiKey) {
    throw new Error('缺少 DEEPSEEK_API_KEY（写入 loop-engineer/.env）')
  }

  const url = `${env.deepseekBaseUrl}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.deepseekApiKey}`,
    },
    body: JSON.stringify({
      model: env.deepseekModel,
      messages,
      tools: DEEPSEEK_TOOLS,
      tool_choice: 'auto',
      temperature: 0.2,
    }),
  })

  const json = (await res.json()) as ChatResponse
  if (!res.ok) {
    throw new Error(`DeepSeek API ${res.status}: ${json.error?.message ?? JSON.stringify(json)}`)
  }
  const msg = json.choices?.[0]?.message
  if (!msg) throw new Error('DeepSeek 返回空 message')
  return msg
}

/**
 * DeepSeek agent：Chat Completions + function calling。
 * 可读写 workspace 内文件（默认 loop-engineer），不改业务子仓库除非 workspace 指向那里。
 */
export async function runDeepseekAgent(opts: AgentRunOptions): Promise<number> {
  const env = getEnv()
  const workspace = opts.workspace ?? LOOP_ROOT

  if (opts.dryRun || process.argv.includes('--dry-prompt')) {
    console.log('--- loop-engineer dry-prompt ---')
    console.log(`loop: ${opts.loop}`)
    console.log(`runtime: deepseek`)
    console.log(`model: ${env.deepseekModel}`)
    console.log(`workspace: ${workspace}`)
    console.log('--- prompt ---')
    console.log(opts.prompt)
    appendLog({
      loop: opts.loop,
      status: 'skipped',
      summary: 'dry-prompt：未调用 DeepSeek',
    })
    return 0
  }

  console.log(`loop-engineer ${opts.loop}: launching DeepSeek agent…`)
  console.log(`  model=${env.deepseekModel}`)
  console.log(`  base=${env.deepseekBaseUrl}`)
  console.log(`  workspace=${workspace}`)

  const system = `你是鹦鹉工厂 Loop Engineer 的执行 agent（DeepSeek）。
你必须通过工具完成任务：list_dir / read_file / write_file / run_shell / done。
工作区：${workspace}
规则：
- 先读 domain 合同与相关 artifacts，再写入/更新 Markdown 工件
- 只改工作区内文件；不要写 .env
- 完成后必须调用 done(summary)
- 用中文思考与摘要`

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: opts.prompt },
  ]

  let finalSummary = ''
  try {
    for (let round = 1; round <= env.deepseekMaxRounds; round += 1) {
      const assistant = await deepseekChat(messages)
      messages.push({
        role: 'assistant',
        content: assistant.content,
        tool_calls: assistant.tool_calls,
      })

      const calls = assistant.tool_calls ?? []
      if (calls.length === 0) {
        // 模型直接文本结束
        finalSummary = (assistant.content ?? '').slice(0, 500)
        console.log(assistant.content ?? '(no content)')
        break
      }

      let finished = false
      for (const call of calls) {
        const name = call.function.name
        const argStr = call.function.arguments ?? '{}'
        process.stdout.write(`  tool[${round}]: ${name}… `)
        const result = runDeepseekTool(workspace, name, argStr)
        console.log(result.ok ? 'ok' : 'fail')
        if (result.content && name !== 'read_file') {
          const preview = result.content.length > 160 ? `${result.content.slice(0, 160)}…` : result.content
          console.log(`    → ${preview.replace(/\n/g, ' ')}`)
        } else if (name === 'read_file') {
          console.log(`    → ${result.ok ? `${result.content.length} chars` : result.content}`)
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result.content,
        })

        if (result.done) {
          finalSummary = result.summary ?? 'done'
          finished = true
        }
      }
      if (finished) break

      if (round === env.deepseekMaxRounds) {
        throw new Error(`超过最大轮次 ${env.deepseekMaxRounds}，未调用 done`)
      }
    }

    console.log(`DeepSeek 完成: ${finalSummary || '(无摘要)'}`)
    appendLog({
      loop: opts.loop,
      status: 'ok',
      summary: `DeepSeek agent 执行结束：${finalSummary || 'ok'}`,
    })
    return 0
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`loop-engineer ${opts.loop}: ${message}`)
    appendLog({ loop: opts.loop, status: 'failed', summary: message })
    return 1
  }
}

/**
 * Cursor Agent CLI（可改业务代码）。仅建议用于 coding loop。
 */
export function runCursorAgent(opts: AgentRunOptions): number {
  const env = getEnv()
  const workspace = opts.workspace ?? LOOP_ROOT
  const bin = resolveAgentBin()

  if (opts.dryRun || process.argv.includes('--dry-prompt')) {
    console.log('--- loop-engineer dry-prompt ---')
    console.log(`loop: ${opts.loop}`)
    console.log(`runtime: cursor`)
    console.log(`workspace: ${workspace}`)
    console.log(`agent: ${bin}`)
    console.log('--- prompt ---')
    console.log(opts.prompt)
    appendLog({
      loop: opts.loop,
      status: 'skipped',
      summary: 'dry-prompt：未调用 Cursor agent',
    })
    return 0
  }

  const args = [
    '-p',
    '--force',
    '--trust',
    '--workspace',
    workspace,
    '--output-format',
    'text',
    ...(env.agentModel ? ['--model', env.agentModel] : []),
    ...(opts.extraArgs ?? []),
    opts.prompt,
  ]

  console.log(`loop-engineer ${opts.loop}: launching Cursor agent…`)
  console.log(`  bin=${bin}`)
  console.log(`  workspace=${workspace}`)
  if (env.agentModel) console.log(`  model=${env.agentModel}`)

  const result = spawnSync(bin, args, {
    cwd: workspace,
    stdio: 'inherit',
    env: process.env,
    encoding: 'utf8',
  })

  if (result.error) {
    const msg = `无法启动 agent（${bin}）：${result.error.message}`
    console.error(`loop-engineer ${opts.loop}: ${msg}`)
    console.error('请确认已安装 Cursor Agent CLI，并已 login / 配置 CURSOR_API_KEY')
    appendLog({ loop: opts.loop, status: 'failed', summary: msg })
    return 1
  }

  const code = result.status ?? 1
  appendLog({
    loop: opts.loop,
    status: code === 0 ? 'ok' : 'failed',
    summary:
      code === 0
        ? 'Cursor agent 执行结束（exit 0）'
        : `Cursor agent 退出码 ${code}`,
  })
  return code
}

/**
 * 统一入口：按 runtime 分发。
 * - coding → Cursor（默认可改代码）
 * - feedback / task / verify / followup → DeepSeek（默认）
 */
export async function runLoopAgent(opts: AgentRunOptions): Promise<number> {
  const runtime = resolveRuntime(opts.loop, opts.runtime)
  if (runtime === 'cursor') {
    return runCursorAgent(opts)
  }
  return runDeepseekAgent(opts)
}
