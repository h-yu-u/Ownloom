/** Native cumulative generation values consumed by display components, without wire details. */
export interface GenerationStatsView {
  source: 'mlx-lm' | 'mlx-vlm'
  generationTokens: number | null
  generationTps: number | null
}
