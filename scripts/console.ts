/**
 * 启动独立 Mission Console（Vite 开发服）
 * 用法：loop-engineer console [--port 4011]
 * 别名：loop-engineer web
 */
import { existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const consoleDir = path.join(root, 'console')

function parsePort(argv: string[]): number {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port') {
      const n = Number(argv[i + 1])
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return 4011
}

function ensureDeps(): number {
  if (!existsSync(path.join(consoleDir, 'package.json'))) {
    console.error('loop-engineer console: 找不到 console/ 目录')
    return 1
  }
  if (!existsSync(path.join(consoleDir, 'node_modules', 'vite'))) {
    console.log('[console] 首次运行，安装依赖…')
    const r = spawnSync('npm', ['install'], {
      cwd: consoleDir,
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32',
    })
    if ((r.status ?? 1) !== 0) {
      console.error('loop-engineer console: npm install 失败')
      return r.status ?? 1
    }
  }
  return 0
}

export async function runConsole(argv = process.argv.slice(2)): Promise<number> {
  const port = parsePort(argv)
  const depCode = ensureDeps()
  if (depCode !== 0) return depCode

  const viteBin = path.join(consoleDir, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!existsSync(viteBin)) {
    console.error('loop-engineer console: 未找到 vite，请在 console/ 执行 npm install')
    return 1
  }

  console.log(`[console] Mission Console → http://127.0.0.1:${port}`)
  console.log('[console] 需同时运行: loop-engineer serve（API :4010）')
  console.log('[console] Ctrl+C 退出')

  const child = spawn(process.execPath, [viteBin, '--port', String(port), '--host', '127.0.0.1'], {
    cwd: consoleDir,
    stdio: 'inherit',
    env: process.env,
  })

  await new Promise<void>((resolve) => {
    const stop = () => {
      child.kill('SIGTERM')
      resolve()
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    child.on('exit', () => resolve())
  })

  return child.exitCode ?? 0
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  runConsole().then((code) => process.exit(code))
}
