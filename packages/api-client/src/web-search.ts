import type { components } from './generated-schema'
import type { Transport } from './transport/ports'
import { record, text, number, malformed } from './decoders'

export type WebSettings = components['schemas']['WebSettingsView']
export type WebTestResult = components['schemas']['WebTestView']
export type WebSettingsUpdate = components['schemas']['WebSettingsUpdate']
export type ChatAttempt = components['schemas']['ChatAttemptRequest']
export function decodeWebSettings(value: unknown): WebSettings {
  const item = record(value)
  if (
    item.provider !== 'tavily' ||
    typeof item.credentialConfigured !== 'boolean' ||
    typeof item.ready !== 'boolean'
  )
    throw malformed()
  return {
    id: text(item.id),
    revision: number(item.revision),
    provider: item.provider,
    baseUrl: text(item.baseUrl),
    credentialConfigured: item.credentialConfigured,
    ready: item.ready,
  }
}
export function webSearchEndpoints(transport: Transport) {
  const path = '/internal/v1/settings/web-search'
  return {
    get: async () => decodeWebSettings(await transport.get(path)),
    save: async (value: WebSettingsUpdate) => decodeWebSettings(await transport.put(path, value)),
    test: async (id: string, revision: number) =>
      decodeWebTest(
        await transport.post(`${path}/test`, { config_id: id, config_revision: revision }),
      ),
  }
}

export function decodeWebTest(value: unknown): WebTestResult {
  const item = record(value)
  if (typeof item.ok !== 'boolean' || (item.partial != null && typeof item.partial !== 'boolean'))
    throw malformed()
  return {
    ...decodeWebSettings(value),
    ok: item.ok,
    elapsedMs: number(item.elapsedMs),
    partial: item.partial === true,
    sourceCount: item.sourceCount == null ? null : number(item.sourceCount),
    readCount: item.readCount == null ? null : number(item.readCount),
  }
}
