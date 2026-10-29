import { record } from './decoders'
import type { components } from './generated-schema'

type NativeStats = components['schemas']['GenerationStats']
export type GenerationStats = NativeStats &
  Required<
    Pick<
      NativeStats,
      | 'source'
      | 'generationTokens'
      | 'generationTps'
      | 'promptTokens'
      | 'promptTps'
      | 'cachedTokens'
    >
  >

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
      draftMode:
        item.draftMode === 'none' || item.draftMode === 'mtp' || item.draftMode === 'dflash2'
          ? item.draftMode
          : null,
      prefillTokens: nonnegative(item.prefillTokens, true),
      prefillMs: nonnegative(item.prefillMs),
      firstTokenMs: nonnegative(item.firstTokenMs),
      durationMs: nonnegative(item.durationMs),
    }
    return [
      stats.generationTokens,
      stats.generationTps,
      stats.promptTokens,
      stats.promptTps,
      stats.cachedTokens,
      stats.prefillTokens,
      stats.prefillMs,
      stats.firstTokenMs,
      stats.durationMs,
    ].some((value) => value !== null)
      ? stats
      : null
  } catch {
    return null
  }
}
