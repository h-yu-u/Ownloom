export function chatOutputLimit(contextLength?: number | null): number {
  const window = contextLength && contextLength > 0 ? contextLength : 8192
  return Math.max(64, window - 128)
}
