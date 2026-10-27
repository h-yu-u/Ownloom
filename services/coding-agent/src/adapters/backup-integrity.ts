import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'

/** Database snapshots can be large; integrity checks never buffer them in memory. */
export async function fileIntegrity(path: string): Promise<{ sha256: string; bytes: number }> {
  const digest = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length
    digest.update(chunk)
  }
  return { sha256: digest.digest('hex'), bytes }
}
