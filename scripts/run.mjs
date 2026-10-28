import { fileURLToPath } from 'node:url'
import { selectTask } from './tasks/index.mjs'
import { runCommands } from './tasks/process.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
try {
  const selection = selectTask(process.argv.slice(2))
  if (selection.help) {
    process.stdout.write(selection.help)
    process.exitCode = selection.exitCode ?? 0
  } else {
    const result = await runCommands(selection.commands, { cwd: root })
    if (result.signal) process.kill(process.pid, result.signal)
    else process.exitCode = result.code
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 2
}
