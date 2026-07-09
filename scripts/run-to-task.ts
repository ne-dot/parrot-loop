/**
 * 【人工】串跑：sync（脚本）→ feedback（agent）→ task（agent）
 * 不含 coding。
 *
 * 用法：loop-engineer run-to-task
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { runFeedbackLoop } from './feedback-loop.js'
import { appendLog } from './lib/log.js'
import { runSyncFeedback } from './sync-feedback.js'
import { runTaskLoop } from './task-loop.js'

export async function runToTask(): Promise<number> {
  console.log('loop-engineer run-to-task: sync → feedback(agent) → task(agent)')
  console.log('（不含 coding；出 proposed task 后须【人工】批准）')

  const syncCode = await runSyncFeedback()
  if (syncCode !== 0) {
    appendLog({
      loop: 'run-to-task',
      status: 'failed',
      summary: `sync 失败，中止（exit ${syncCode}）`,
    })
    return syncCode
  }

  const feedbackCode = await runFeedbackLoop()
  if (feedbackCode !== 0) {
    appendLog({
      loop: 'run-to-task',
      status: 'failed',
      summary: `feedback agent 失败，中止（exit ${feedbackCode}）`,
    })
    return feedbackCode
  }

  const taskCode = await runTaskLoop()
  appendLog({
    loop: 'run-to-task',
    status: taskCode === 0 ? 'ok' : 'failed',
    summary: `串跑结束：sync ok → feedback exit ${feedbackCode} → task exit ${taskCode}`,
  })

  if (taskCode === 0) {
    console.log('')
    console.log('下一步【人工·门禁】：')
    console.log('  1. 打开 artifacts/tasks/task-*.md（若有新建）')
    console.log('  2. 将 status: proposed 改为 status: approved')
    console.log('  3. 再运行：loop-engineer coding --task <task-id>')
  }

  return taskCode
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  runToTask().then((code) => process.exit(code))
}
