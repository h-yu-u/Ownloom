/** Native cumulative generation values consumed by display components, without wire details. */
export interface GenerationStatsView {
  source: 'mlx-lm' | 'mlx-vlm'
  generationTokens: number | null
  generationTps: number | null
  promptTokens?: number | null
  promptTps?: number | null
  cachedTokens?: number | null
  draftMode?: 'none' | 'mtp' | 'dflash2' | null
  prefillTokens?: number | null
  prefillMs?: number | null
  firstTokenMs?: number | null
  durationMs?: number | null
}
