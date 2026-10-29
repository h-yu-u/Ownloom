import { streamSimpleOpenAICompletions } from '@earendil-works/pi-ai/compat'
import type { ProviderConfig } from '@earendil-works/pi-coding-agent'
import { object } from '../domain/types.js'

/** Keep Pi's compaction reserve separate from the actual per-request output ceiling. */
export function codingStream(contextWindow: number): NonNullable<ProviderConfig['streamSimple']> {
  return (model, context, options) =>
    streamSimpleOpenAICompletions({ ...model, api: 'openai-completions' }, context, {
      ...options,
      onPayload: async (original, selected) => {
        const payload = object((await options?.onPayload?.(original, selected)) ?? original)
        // Compaction/summaries have no tools and keep their explicit short budget.
        if (!Array.isArray(payload.tools) || !payload.tools.length) return payload
        return {
          ...payload,
          max_tokens: null,
          output_budget: 'remaining',
          context_limit: contextWindow,
        }
      },
    })
}
