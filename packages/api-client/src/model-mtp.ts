import type { components } from './generated-schema'
import { malformed, number, record, text } from './decoders'

export function decodeMtp(value: unknown): components['schemas']['MtpSettingsView'] | null {
  if (value == null) return null
  const item = record(value)
  const draftPath = text(item.draftPath)
  const blockSize = number(item.blockSize)
  if (!draftPath.trim() || (blockSize !== 3 && blockSize !== 4)) throw malformed()
  return { draftPath, blockSize }
}
