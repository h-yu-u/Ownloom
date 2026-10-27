/** Model-window settings for Pi. No JSON-byte admission before SDK compaction. */
export function contextSettings(window: number) {
  const output = Math.min(4096, Math.max(512, Math.floor(window / 8)))
  return {
    output,
    reserveTokens: Math.min(Math.floor(window / 3), output + 512),
    keepRecentTokens: Math.max(256, Math.floor(window / 4)),
  }
}
