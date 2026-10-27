import { open, stat } from 'node:fs/promises'
import type { SessionManager } from '@earendil-works/pi-coding-agent'
import type { TranscriptDescriptor } from '../domain/types.js'

export async function validateTranscript(
  path: string,
  cwd: string,
  descriptor?: TranscriptDescriptor,
): Promise<void> {
  let file
  try {
    file = await open(path, 'r')
  } catch (error) {
    if (
      descriptor?.state === 'allocated' &&
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return
    throw new Error('TRANSCRIPT_MISSING')
  }
  try {
    if ((await file.stat()).size > 256 * 1024 * 1024) throw new Error('TRANSCRIPT_TOO_LARGE')
    const decoder = new TextDecoder('utf-8', { fatal: true }),
      seen = new Set<string>()
    let pending = '',
      header = false
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      pending += decoder.decode(chunk, { stream: true })
      if (Buffer.byteLength(pending) > 4 * 1024 * 1024) throw new Error('TRANSCRIPT_LINE_TOO_LARGE')
      let newline
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        if (Buffer.byteLength(line) > 4 * 1024 * 1024) throw new Error('TRANSCRIPT_LINE_TOO_LARGE')
        if (!line.trim()) continue
        const entry: unknown = JSON.parse(line)
        if (!entry || typeof entry !== 'object' || !('type' in entry))
          throw new Error('TRANSCRIPT_CORRUPT')
        if (!header) {
          if (
            entry.type !== 'session' ||
            !('cwd' in entry) ||
            (entry.cwd !== cwd &&
              !(descriptor?.restoredCwd === cwd && descriptor.sourceCwd === entry.cwd)) ||
            (descriptor && (!('id' in entry) || entry.id !== descriptor.piSessionId))
          )
            throw new Error('TRANSCRIPT_MISMATCH')
          header = true
        } else {
          if (!('id' in entry) || typeof entry.id !== 'string' || seen.has(entry.id))
            throw new Error('TRANSCRIPT_CORRUPT')
          if (
            'parentId' in entry &&
            entry.parentId !== null &&
            (typeof entry.parentId !== 'string' || !seen.has(entry.parentId))
          )
            throw new Error('TRANSCRIPT_CORRUPT')
          seen.add(entry.id)
        }
      }
      if (Buffer.byteLength(pending) > 4 * 1024 * 1024) throw new Error('TRANSCRIPT_LINE_TOO_LARGE')
    }
    pending += decoder.decode()
    if (
      !header ||
      pending.trim() ||
      (descriptor?.lastKnownEntryId && !seen.has(descriptor.lastKnownEntryId))
    )
      throw new Error('TRANSCRIPT_CORRUPT')
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('TRANSCRIPT_')) throw error
    throw new Error('TRANSCRIPT_CORRUPT')
  } finally {
    await file.close()
  }
}

export async function checkpoint(
  manager: SessionManager,
  id: string,
): Promise<TranscriptDescriptor> {
  const path = manager.getSessionFile()
  if (!path) throw new Error('TRANSCRIPT_PATH_MISSING')
  let materialized = false
  try {
    materialized = (await stat(path)).size > 0
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  const descriptor: TranscriptDescriptor = {
    productSessionId: id,
    piSessionId: manager.getSessionId(),
    path,
    state: materialized ? 'materialized' : 'allocated',
    lastKnownEntryId: materialized ? manager.getLeafId() : null,
  }
  if (materialized) await validateTranscript(path, manager.getCwd(), descriptor)
  return descriptor
}
