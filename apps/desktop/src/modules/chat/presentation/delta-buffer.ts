/** Limits reactive updates while preserving every delta and flushing before terminal events. */
export function createDeltaBuffer(deliver: (jobId: string, text: string) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let jobId = ''
  let chunks: string[] = []
  function flush(): void {
    clearTimeout(timer)
    timer = undefined
    if (!chunks.length) return
    const text = chunks.join('')
    chunks = []
    deliver(jobId, text)
  }
  function push(id: string, text: string): void {
    if (jobId !== id) flush()
    jobId = id
    chunks.push(text)
    if (timer !== undefined) return
    flush()
    timer = setTimeout(flush, 32)
  }
  return { push, flush }
}
