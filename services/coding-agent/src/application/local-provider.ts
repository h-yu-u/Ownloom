import { object, string } from '../domain/types.js'
import type { Provider } from './ports.js'
export function localProvider(params: Record<string, unknown>): Provider {
  const value = object(params.provider)
  const baseUrl = string(value.baseUrl)
  if (!/^http:\/\/127\.0\.0\.1:\d+\/internal\/v1\/inference$/.test(baseUrl))
    throw new Error('LOCAL_PROVIDER_REQUIRED')
  return {
    modelId: string(value.modelId),
    baseUrl,
    token: string(value.token),
    fingerprint: typeof value.fingerprint === 'string' ? value.fingerprint : 'unverified',
    engineVersion: typeof value.engineVersion === 'string' ? value.engineVersion : 'unverified',
    contextWindow: typeof value.contextWindow === 'number' ? value.contextWindow : 32768,
  }
}
