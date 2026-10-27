import { fileIntegrity } from './backup-integrity.js'
import type { Session } from '../domain/types.js'
import { validateTranscript } from './transcript.js'
import { mkdir, readFile, writeFile, realpath, lstat, copyFile, chmod } from 'node:fs/promises'
import { join, dirname, resolve, relative, isAbsolute } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

interface ExportFile {
  path: string
  sha256: string
  bytes: number
  source?: string
}

/** Only this owner opens Coding/Agent/Extension databases. The live profile stays untouched. */
export async function restoreData(identifier: string): Promise<{ imported: boolean }> {
  const root = process.env.MLX_STUDIO_PROFILE_ROOT
  if (!root || !/^[0-9a-f-]{36}$/.test(identifier)) throw new Error('RESTORE_PATH_INVALID')
  const source = await realpath(join(root, '.restore', identifier, 'verified', 'node'))
  const target = join(root, 'profiles', identifier, 'data', 'coding')
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')) as {
    version: number
    files: ExportFile[]
  }
  if (manifest.version !== 1 || !Array.isArray(manifest.files))
    throw new Error('BACKUP_MANIFEST_INVALID')
  const files = new Map<string, ExportFile>()
  for (const item of manifest.files) {
    const rel = relative(source, resolve(source, item.path))
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || files.has(item.path))
      throw new Error('BACKUP_PATH_INVALID')
    const path = join(source, rel)
    if (!(await lstat(path)).isFile() || (await realpath(path)) !== resolve(path))
      throw new Error('BACKUP_PATH_INVALID')
    const integrity = await fileIntegrity(path)
    if (integrity.bytes !== item.bytes || integrity.sha256 !== item.sha256)
      throw new Error('BACKUP_HASH_MISMATCH')
    files.set(item.path, item)
  }
  await mkdir(target, { recursive: true, mode: 0o700 })
  for (const [name, destination] of [
    ['coding.db', 'coding.db'],
    ['agent-chat.db', 'agent-chat/agent-chat.db'],
    ['extensions.db', 'extensions.db'],
  ]) {
    if (!files.has(name!)) throw new Error('BACKUP_OWNER_MISSING')
    const path = join(target, destination!)
    await mkdir(dirname(path), { recursive: true })
    const incoming = new DatabaseSync(join(source, name!), { readOnly: true })
    try {
      if (incoming.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
        throw new Error('BACKUP_DATABASE_INVALID')
      incoming.prepare('VACUUM INTO ?').run(path)
    } finally {
      incoming.close()
    }
  }
  for (const item of files.values()) {
    if (!item.path.startsWith('skills/') && !item.path.startsWith('transcripts/')) continue
    const path = join(target, item.path)
    await mkdir(dirname(path), { recursive: true })
    await copyFile(join(source, item.path), path)
    await chmod(path, 0o600)
  }
  for (const [name, kind, owner] of [
    ['coding.db', 'session', 'coding'],
    ['agent-chat/agent-chat.db', 'agentSession', 'agent'],
  ]) {
    const db = new DatabaseSync(join(target, name!))
    try {
      for (const row of db.prepare('SELECT id,value FROM entities WHERE kind=?').all(kind!)) {
        const session = JSON.parse(String(row.value)) as Pick<
          Session,
          'id' | 'piPath' | 'transcript'
        >
        if (!session.piPath) continue
        const item = files.get(`transcripts/${owner}/${session.id}.jsonl`)
        if (!item) {
          if (session.transcript?.state !== 'allocated') throw new Error('TRANSCRIPT_MISSING')
          session.piPath = null
          delete session.transcript
        } else {
          const path = join(target, item.path)
          if ((await lstat(path)).size > 256 * 1024 * 1024) throw new Error('TRANSCRIPT_TOO_LARGE')
          const header = JSON.parse((await readFile(path, 'utf8')).split('\n')[0]!) as {
            cwd: string
          }
          session.piPath = path
          if (session.transcript) {
            session.transcript.path = path
            session.transcript.sourceCwd = header.cwd
            session.transcript.restoredCwd =
              kind === 'agentSession' ? join(target, 'agent-chat') : header.cwd
          }
          await validateTranscript(
            path,
            session.transcript?.restoredCwd ?? header.cwd,
            session.transcript,
          )
        }
        db.prepare('UPDATE entities SET value=? WHERE kind=? AND id=?').run(
          JSON.stringify(session),
          kind!,
          String(row.id),
        )
      }
    } finally {
      db.close()
    }
  }
  await writeFile(join(target, 'restore-complete'), identifier, { mode: 0o600 })
  return { imported: true }
}
