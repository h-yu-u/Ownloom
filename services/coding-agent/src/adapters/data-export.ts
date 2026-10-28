import { fileIntegrity } from './backup-integrity.js'
import { validateTranscript } from './transcript.js'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, readdir, lstat, rm } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import type { Repository } from './repository.js'
import type { ExtensionsRepository } from './extensions/repository.js'

/** Called with admission closed and every Pi session idle. SQLite and JSONL keep their owners. */
export async function exportData(
  repo: Repository,
  agent: Repository,
  extensions: ExtensionsRepository,
) {
  const directory = join(repo.directory, 'exports', randomUUID())
  await mkdir(directory, { recursive: true, mode: 0o700 })
  try {
    return await writeExport(repo, agent, extensions, directory)
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

async function writeExport(
  repo: Repository,
  agent: Repository,
  extensions: ExtensionsRepository,
  directory: string,
) {
  repo.exportDatabase(join(directory, 'coding.db'))
  agent.exportDatabase(join(directory, 'agent-chat.db'))
  extensions.exportDatabase(join(directory, 'extensions.db'))
  const files: { path: string; sha256: string; bytes: number; source?: string }[] = []
  async function save(path: string, bytes: Buffer, source?: string) {
    const destination = join(directory, path)
    await mkdir(join(destination, '..'), { recursive: true })
    await writeFile(destination, bytes, { mode: 0o600 })
    files.push({
      path,
      source,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  for (const [owner, sessions] of [
    ['coding', repo.list('session')],
    ['agent', agent.list('agentSession')],
  ] as const) {
    for (const session of sessions) {
      if (!session.piPath) continue
      const rel = relative(repo.directory, session.piPath)
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('TRANSCRIPT_PATH_INVALID')
      let bytes: Buffer
      try {
        if ((await lstat(session.piPath)).size > 256 * 1024 * 1024)
          throw new Error('TRANSCRIPT_TOO_LARGE')
        bytes = await readFile(session.piPath)
      } catch (error) {
        if (
          session.transcript?.state === 'allocated' &&
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          continue
        throw new Error('TRANSCRIPT_MISSING')
      }
      const header = JSON.parse(bytes.subarray(0, bytes.indexOf(10)).toString('utf8')) as {
        cwd: string
      }
      await validateTranscript(session.piPath, header.cwd, session.transcript)
      const end = bytes.lastIndexOf(10) + 1
      if (!end) throw new Error('TRANSCRIPT_CORRUPT')
      await save(`transcripts/${owner}/${session.id}.jsonl`, bytes.subarray(0, end), session.piPath)
    }
  }
  async function skills(root: string, prefix: string): Promise<void> {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const path = join(root, entry.name),
        target = `${prefix}/${entry.name}`
      if ((await lstat(path)).isSymbolicLink()) continue
      if (entry.isDirectory()) await skills(path, target)
      else if (entry.isFile()) await save(target, await readFile(path))
    }
  }
  await skills(join(repo.directory, 'skills'), 'skills')
  for (const path of ['coding.db', 'agent-chat.db', 'extensions.db']) {
    files.push({ path, ...(await fileIntegrity(join(directory, path))) })
  }
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({
      version: 1,
      files,
      recovery:
        'Restore databases and verified JSONL prefixes together; interrupt unfinished runs; never replay tools.',
    }),
  )
  return { directory }
}
