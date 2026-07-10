/**
 * 本地一键拉起全部 loop worker（子进程）
 * 用法：loop-engineer workers
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ALL_LOOPS } from './lib/loop-types.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const tsxCli = require.resolve('tsx/cli')

export async function runWorkers(): Promise<void> {
  const children: ChildProcess[] = []

  console.log('[workers] starting all loop workers…')
  for (const loop of ALL_LOOPS) {
    const child = spawn(
      process.execPath,
      [tsxCli, path.join(root, 'scripts', 'worker.ts'), '--loop', loop],
      {
        cwd: root,
        stdio: 'inherit',
        env: process.env,
      },
    )
    children.push(child)
    console.log(`[workers] spawned ${loop} pid=${child.pid}`)
  }

  const shutdown = () => {
    console.log('[workers] stopping children…')
    for (const c of children) {
      c.kill('SIGTERM')
    }
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await new Promise(() => {
    /* keep alive */
  })
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  runWorkers().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
