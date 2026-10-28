import { acceptanceTasks } from './acceptance.mjs'
import { contractTasks } from './contracts.mjs'
import { desktopTasks } from './desktop.mjs'
import { codingTasks } from './coding.mjs'
import { repositoryTasks } from './repository.mjs'
import { runtimeTasks } from './runtime.mjs'
import { task } from './commands.mjs'

const modules = {
  ...repositoryTasks,
  ...desktopTasks,
  ...runtimeTasks,
  ...codingTasks,
  ...contractTasks,
  ...acceptanceTasks,
}
const combine = (action, targets) =>
  targets.flatMap((target) => modules[`${action}:${target}`].commands)

export const tasks = {
  ...modules,
  dev: modules['dev:desktop'],
  check: task(
    'Run all source checks (Rust is opt-in).',
    combine('check', ['tokens', 'docs', 'format', 'frontend', 'runtime', 'coding', 'boundaries']),
  ),
  test: task(
    'Run all automated tests (Rust and real models are opt-in).',
    combine('test', ['frontend', 'runtime', 'coding', 'acceptance', 'tooling']),
  ),
}
export const actions = [
  'bootstrap',
  'dev',
  'check',
  'test',
  'build',
  'generate',
  'format',
  'verify',
]

export function help(action, target) {
  const heading = action
    ? `Usage: pnpm ${action} [target] [--help]`
    : 'Usage: node scripts/run.mjs <action> [target]'
  const key = target ? `${action}:${target}` : action
  const selected = target && tasks[key]
  const entries = selected
    ? [[key, selected]]
    : Object.entries(tasks).filter(
        ([name]) => !action || name === action || name.startsWith(`${action}:`),
      )
  const lines = entries.map(
    ([name, entry]) => `  pnpm ${name.replace(':', ' ')}  ${entry.description}`,
  )
  return (
    [
      heading,
      '',
      ...lines,
      '',
      'Defaults: dev = desktop; check/test = all non-Rust groups; format = source files.',
      'build, generate and verify require a target; omission only prints help.',
      'Only verify forwards script arguments. Example: pnpm verify chat --model-path /path/to/model',
      "An optional -- after the target separates script arguments; -- --help requests the script's own help.",
    ].join('\n') + '\n'
  )
}

export function selectTask(argv) {
  const [action, ...supplied] = argv
  if (!action || action === '--help' || action === '-h') return { help: help() }
  if (!actions.includes(action)) throw new Error(`Unknown action: ${action}`)
  const args = supplied[0] === '--' ? supplied.slice(1) : supplied
  if (args[0] === '--help' || args[0] === '-h') return { help: help(action) }
  const target = args[0]
  const key = target ? `${action}:${target}` : action
  const entry = tasks[key]
  if (!entry) {
    if (!target) return { help: help(action), exitCode: 2 }
    throw new Error(`Unknown target for ${action}: ${target}. Run pnpm ${action} --help.`)
  }
  let forwarded = target ? args.slice(1) : []
  if (forwarded[0] === '--help' || forwarded[0] === '-h') return { help: help(action, target) }
  if (forwarded[0] === '--') forwarded = forwarded.slice(1)
  if (forwarded.length && !entry.forwardArgs)
    throw new Error(`pnpm ${action}${target ? ` ${target}` : ''} does not accept script arguments.`)
  return {
    commands: entry.commands.map((step, index) => ({
      ...step,
      args: [...step.args, ...(index === entry.commands.length - 1 ? forwarded : [])],
    })),
  }
}
