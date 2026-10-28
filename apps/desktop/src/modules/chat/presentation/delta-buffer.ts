import type { GenerationStatsView } from '../../../shared/lib/generation-stats'

/** Limits reactive updates while preserving every delta and flushing before terminal events. */
export function createDeltaBuffer(
  deliver: (jobId: string, text: string, stats?: GenerationStatsView | null) => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let jobId = ''
  let chunks: string[] = []
  let generationStats: GenerationStatsView | null | undefined
  function flush(): void {
    clearTimeout(timer)
    timer = undefined
    if (!chunks.length) return
    const text = chunks.join('')
    const stats = generationStats
    chunks = []
    generationStats = undefined
    if (stats === undefined) deliver(jobId, text)
    else deliver(jobId, text, stats)
  }
  function push(id: string, text: string, stats?: GenerationStatsView | null): void {
    if (jobId !== id) flush()
    jobId = id
    chunks.push(text)
    if (stats !== undefined) generationStats = stats
    if (timer !== undefined) return
    flush()
    timer = setTimeout(flush, 32)
  }
  return { push, flush }
}
