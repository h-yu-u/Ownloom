import { object } from '../domain/types.js'

/** One Pi provider request owns its optional, Runtime-validated native measurements. */
export class ProviderMeasurements {
  private current: Record<string, unknown> | undefined

  begin(): void {
    this.current = undefined
  }

  observe(chunk: unknown): void {
    const frame = optionalObject(chunk)
    if (!frame || !Array.isArray(frame.choices) || frame.choices.length || !frame.usage) return
    this.current = undefined
    const stats = optionalObject(optionalObject(frame.ownloom)?.generationStats)
    if (!stats || (stats.source !== 'mlx-lm' && stats.source !== 'mlx-vlm')) return
    // This adapter transports an optional extension; the UI decoder owns display validation.
    // Pick only public scalar fields, never arbitrary provider payloads or token content.
    const scalars = Object.fromEntries(
      [
        'generationTokens',
        'generationTps',
        'promptTokens',
        'promptTps',
        'cachedTokens',
        'prefillTokens',
        'prefillMs',
        'firstTokenMs',
        'durationMs',
      ].map((key) => {
        const value = stats[key]
        return [
          key,
          typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null,
        ]
      }),
    )
    if (Object.values(scalars).every((value) => value === null)) return
    const mode = stats.draftMode
    this.current = {
      source: stats.source,
      ...scalars,
      draftMode: mode === 'none' || mode === 'mtp' || mode === 'dflash2' ? mode : null,
    }
  }

  finish(stopReason: string): Record<string, unknown> | undefined {
    return stopReason === 'stop' || stopReason === 'toolUse' ? this.current : undefined
  }
}

function optionalObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? object(value) : undefined
}
