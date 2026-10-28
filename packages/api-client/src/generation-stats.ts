import { record } from './decoders'
import type { components } from './generated-schema'

export type GenerationStats = Required<components['schemas']['GenerationStats']>

function nonnegative(value: unknown, integer = false): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    (!integer || Number.isSafeInteger(value))
    ? value
    : null
}

/** Optional native metadata must never make an otherwise valid answer unreadable. */
export function decodeGenerationStats(value: unknown): GenerationStats | null {
  if (value == null) return null
  try {
    const item = record(value)
    if (item.source !== 'mlx-lm' && item.source !== 'mlx-vlm') return null
    const stats: GenerationStats = {
      source: item.source,
      generationTokens: nonnegative(item.generationTokens, true),
      generationTps: nonnegative(item.generationTps),
      promptTokens: nonnegative(item.promptTokens, true),
      promptTps: nonnegative(item.promptTps),
      cachedTokens: nonnegative(item.cachedTokens, true),
    }
    return [
      stats.generationTokens,
      stats.generationTps,
      stats.promptTokens,
      stats.promptTps,
      stats.cachedTokens,
    ].some((value) => value !== null)
      ? stats
      : null
  } catch {
    return null
  }
}
