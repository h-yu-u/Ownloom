import type { components } from './generated-schema'
import type { Transport } from './transport/ports'
import { record, text, nullableText } from './decoders'
export type TextAssistantRequest = components['schemas']['TextAssistantRequest']
export type TextAssistantView = components['schemas']['TextAssistantView']
function decode(value: unknown): TextAssistantView {
  const v = record(value)
  return {
    jobId: text(v.jobId),
    state: text(v.state),
    errorCode: nullableText(v.errorCode),
    text: text(v.text),
  }
}
export function textAssistantEndpoints(transport: Pick<Transport, 'get' | 'post'>) {
  const root = '/internal/v1/extensions/assist'
  return {
    create: async (body: TextAssistantRequest) => decode(await transport.post(root, body)),
    get: async (id: string) => decode(await transport.get(`${root}/${encodeURIComponent(id)}`)),
    cancel: async (id: string) =>
      decode(await transport.post(`${root}/${encodeURIComponent(id)}/cancel`)),
  }
}
