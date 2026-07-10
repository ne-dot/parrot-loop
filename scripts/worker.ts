/**
 * 一 loop 一 worker
 * 用法：loop-engineer worker --loop sync|feedback|task|coding|verify|followup
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { ALL_LOOPS } from './lib/loop-types.js'
import { parseLoopArg, startLoopWorker } from './lib/loop-worker.js'

export async function runWorker(argv = process.argv.slice(2)): Promise<void> {
  const loop = parseLoopArg(argv)
  if (!loop) {
    console.error('用法: loop-engineer worker --loop sync|feedback|task|coding|verify|followup')
    console.error(`可选: ${ALL_LOOPS.join(' | ')}`)
    process.exit(1)
  }

  const worker = await startLoopWorker(loop)

  const shutdown = async () => {
    console.log(`[${loop}-worker] shutting down…`)
    await worker.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  runWorker().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
