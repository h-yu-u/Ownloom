import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Launch the actual shipped Host, discover bundled resources, then await orderly shutdown. */
export async function verifyExtensionsBundle(root) {
  const directory = await mkdtemp(join(tmpdir(), 'mlx-extension-bundle-'))
  const child = spawn(join(root, 'bin/node'), [join(root, 'dist/main.js'), directory], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      PATH: '/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
      HOME: process.env.HOME ?? '',
      PI_CODING_AGENT_DIR: join(directory, 'pi'),
    },
  })
  let catalog = false,
    buffer = '',
    diagnostics = '',
    hostEpoch = '',
    protocolVersion = 0
  child.stderr.on('data', (chunk) => {
    diagnostics = (diagnostics + chunk.toString('utf8')).slice(-16000)
  })
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error('Bundled extension Host timed out'))
      }, 15000)
      child.once('error', reject)
      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString('utf8')
        let boundary = buffer.indexOf('\n')
        try {
          while (boundary >= 0) {
            const frame = JSON.parse(buffer.slice(0, boundary))
            buffer = buffer.slice(boundary + 1)
            if (frame.type === 'host.ready') {
              hostEpoch = frame.hostEpoch
              protocolVersion = frame.protocolVersion
              child.stdin.write(
                JSON.stringify({
                  protocolVersion,
                  hostEpoch,
                  requestId: 'catalog',
                  method: 'extensions.catalog.list',
                  params: {},
                }) + '\n',
              )
            } else if (frame.requestId === 'catalog') {
              if (
                frame.error ||
                !frame.result.skills.some((skill) => skill.id === 'builtin_studio-image-prompts') ||
                !frame.result.builtinTools.some((tool) => tool.originalName === 'image_generate')
              )
                throw new Error('Bundled extension resources are incomplete')
              catalog = true
              child.stdin.write(
                JSON.stringify({
                  protocolVersion,
                  hostEpoch,
                  requestId: 'shutdown',
                  method: 'shutdown',
                  params: {},
                }) + '\n',
              )
            }
            boundary = buffer.indexOf('\n')
          }
        } catch (error) {
          clearTimeout(timer)
          child.kill('SIGKILL')
          reject(error)
        }
      })
      child.once('close', (code, signal) => {
        clearTimeout(timer)
        if (code === 0 && catalog) resolve()
        else
          reject(
            new Error(
              `Bundled extension Host failed (exit=${code}, signal=${signal ?? 'none'})\n${diagnostics}`,
            ),
          )
      })
    })
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await new Promise((resolve) => child.once('close', resolve))
    }
    await rm(directory, { recursive: true, force: true })
  }
}
