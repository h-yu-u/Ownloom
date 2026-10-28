/** Commands are argument arrays; the runner never interprets a shell command string. */
export const command = (program, ...args) => ({ program, args })
export const pnpm = (...args) => command('pnpm', ...args)
export const node = (...args) => command(process.execPath, ...args)
export const uv = (...args) =>
  command('uv', 'run', '--project', 'services/runtime', '--python', '3.12', ...args)
export const python = (module, ...args) => ({
  ...uv('python', '-m', module, ...args),
  pythonPath: 'services/runtime/src',
})
export const task = (description, commands, forwardArgs = false) => ({
  description,
  commands,
  forwardArgs,
})
