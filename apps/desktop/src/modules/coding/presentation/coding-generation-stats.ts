import { decodeGenerationStats } from '@mlx-studio/api-client'
import type { GenerationStatsView } from '../../../shared/lib/generation-stats'
import type { CodingEvent } from '../application/ports'

/** A completed model turn owns its measured values; run and tool durations are separate. */
export function codingGenerationStats(event: CodingEvent): GenerationStatsView | null {
  const data = event.data
  if (
    event.type !== 'assistant.message' ||
    !data ||
    typeof data !== 'object' ||
    !('stopReason' in data) ||
    typeof data.stopReason !== 'string' ||
    !['stop', 'toolUse'].includes(data.stopReason) ||
    ('error' in data && data.error) ||
    !('generationStats' in data)
  )
    return null
  return decodeGenerationStats(data.generationStats)
}
