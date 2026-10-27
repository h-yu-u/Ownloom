import type { PiSession } from './ports.js'

// Preserve a stable Runtime code without persisting arbitrary provider response bodies.
export function providerErrorCode(message: string | undefined): string | undefined {
  const normalized = message?.replaceAll('\\"', '"')
  const runtimeCode = normalized?.match(/"runtimeCode"\s*:\s*"([A-Z][A-Z0-9_]{1,79})"/)?.[1]
  if (
    runtimeCode &&
    ['EXTENSION_CONTEXT_BUDGET_EXCEEDED', 'CONTEXT_BUDGET_EXCEEDED'].includes(runtimeCode)
  )
    return runtimeCode
  const code = message?.replaceAll('\\"', '"').match(/"code"\s*:\s*"([A-Z][A-Z0-9_]{1,79})"/)?.[1]
  if (code) return code
  if (message === 'Connection error.' || message === 'fetch failed')
    return 'MODEL_CONNECTION_FAILED'
  if (message === 'Request timed out.') return 'MODEL_REQUEST_TIMEOUT'
  return undefined
}
export function checkModel(pi: PiSession): void {
  const reason = pi.lastStopReason()
  if (reason === 'error' || reason === 'aborted' || reason === 'length')
    throw new Error(
      reason === 'length'
        ? 'MODEL_OUTPUT_TRUNCATED'
        : (pi.lastErrorCode() ?? 'MODEL_INFERENCE_FAILED'),
    )
}
