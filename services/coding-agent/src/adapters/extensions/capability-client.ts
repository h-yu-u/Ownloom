import type { ActiveCapability, RunRuntime } from '../../application/ports.js'
import { object, string } from '../../domain/types.js'
export async function capabilityRequest(
  runtime: { capabilityUrl: string },
  token: string,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const url = new URL(runtime.capabilityUrl)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/internal/v1/agent-capabilities'
  )
    throw new Error('LOCAL_PROVIDER_REQUIRED')
  const response = await fetch(url.href + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(path === '/activate' || path === '/close' ? 15000 : 1200000),
    ]),
    redirect: 'error',
  })
  const result: unknown = await response.json()
  if (!response.ok) {
    const error = object(object(result).error)
    throw new Error(
      typeof error.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(error.code)
        ? error.code
        : 'CAPABILITY_REQUEST_FAILED',
    )
  }
  return object(result)
}
export async function activateCapability(
  runtime: RunRuntime,
  signal: AbortSignal,
): Promise<ActiveCapability> {
  const result = await capabilityRequest(runtime, runtime.bootstrapToken, '/activate', {}, signal)
  return { capabilityUrl: runtime.capabilityUrl, token: string(result.token) }
}
export async function closeCapability(
  runtime: RunRuntime,
  active?: ActiveCapability,
): Promise<void> {
  await capabilityRequest(runtime, active?.token ?? runtime.bootstrapToken, '/close', {})
}
