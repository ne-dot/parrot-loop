#!/usr/bin/env node
/**
 * bin 入口：把参数转给 scripts/cli.ts（经 tsx）。
 * 用法：loop-engineer --help
 *       loop-engineer <command> …
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const tsxCli = require.resolve('tsx/cli')
const cliTs = path.join(root, 'scripts', 'cli.ts')

const result = spawnSync(
  process.execPath,
  [tsxCli, cliTs, ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  },
)

process.exit(result.status ?? 1)
