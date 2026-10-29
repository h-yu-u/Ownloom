import type { components } from './generated-schema'
import { malformed, number, record, nullableText } from './decoders'

export function decodeDraft(value: unknown): components['schemas']['DraftSettingsView'] | null {
  if (value == null) return null
  const item = record(value)
  const { enabled, mode } = item
  const mtpPath = nullableText(item.mtpPath)
  const dflashPath = nullableText(item.dflashPath)
  const mtpBlockSize = number(item.mtpBlockSize)
  const dflashBlockSize = number(item.dflashBlockSize)
  if (
    typeof enabled !== 'boolean' ||
    !['auto', 'mtp', 'dflash2'].includes(String(mode)) ||
    (mode !== 'auto' && mode !== 'mtp' && mode !== 'dflash2') ||
    (mtpBlockSize !== 3 && mtpBlockSize !== 4) ||
    (dflashBlockSize !== 4 && dflashBlockSize !== 5) ||
    (mtpPath !== null && !mtpPath.trim()) ||
    (dflashPath !== null && !dflashPath.trim()) ||
    (enabled && mode !== 'dflash2' && !mtpPath) ||
    (enabled && mode !== 'mtp' && !dflashPath)
  )
    throw malformed()
  return { enabled, mode, mtpPath, dflashPath, mtpBlockSize, dflashBlockSize }
}
