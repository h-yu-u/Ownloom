import { spawn } from 'node:child_process'
import { delimiter, resolve } from 'node:path'

function execute(step, { cwd, env }) {
  return new Promise((done) => {
    const environment = { ...env, ...step.env }
    if (step.pythonPath)
      environment.PYTHONPATH = [resolve(cwd, step.pythonPath), environment.PYTHONPATH]
        .filter(Boolean)
        .join(delimiter)
    const grouped = process.platform !== 'win32'
    const child = spawn(step.program, step.args, {
      cwd,
      env: environment,
      stdio: 'inherit',
      shell: false,
      detached: grouped,
    })
    let interrupted, timer
    function stop(signal) {
      if (!child.pid) return
      try {
        if (grouped) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch (error) {
        if (error.code !== 'ESRCH') process.stderr.write(`${error.message}\n`)
      }
    }
    function interrupt(signal) {
      if (interrupted) return stop('SIGKILL')
      interrupted = signal
      stop(signal)
      timer = setTimeout(() => stop('SIGKILL'), 5000)
      timer.unref()
    }
    const onInterrupt = () => interrupt('SIGINT')
    const onTerminate = () => interrupt('SIGTERM')
    process.on('SIGINT', onInterrupt)
    process.on('SIGTERM', onTerminate)
    function finish(result) {
      clearTimeout(timer)
      if (interrupted) stop('SIGKILL')
      process.off('SIGINT', onInterrupt)
      process.off('SIGTERM', onTerminate)
      done(interrupted ? { code: 1, signal: interrupted } : result)
    }
    child.once('error', (error) => {
      process.stderr.write(`Cannot run ${step.program}: ${error.message}\n`)
      finish({ code: error.code === 'ENOENT' ? 127 : 1 })
    })
    child.once('close', (code, signal) => finish({ code: code ?? 1, signal }))
  })
}

/** Run a flat, ordered plan and stop on the first failure or interruption. */
export async function runCommands(commands, { cwd, env = process.env }) {
  for (const step of commands) {
    process.stdout.write(`> ${[step.program, ...step.args].join(' ')}\n`)
    const result = await execute(step, { cwd, env })
    if (result.code !== 0 || result.signal) return result
  }
  return { code: 0 }
}
