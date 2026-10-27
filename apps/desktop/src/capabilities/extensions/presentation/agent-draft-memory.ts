import { ref } from 'vue'
import { ScopedTextDrafts, type TextDraftSnapshot } from '../../../shared/lib/scoped-text-drafts'
import type { AgentChatRequest } from '@mlx-studio/api-client'
export { copyExtensionSelection as copySelection } from '@mlx-studio/api-client'
export interface PendingAgentSubmission {
  targetSessionId: string
  request: Readonly<AgentChatRequest>
  draft: TextDraftSnapshot
  state: 'submitting' | 'unknown'
}
export function createAgentDraftMemory() {
  const revision = ref(0)
  return {
    drafts: new ScopedTextDrafts(() => revision.value++),
    revision,
    lastSessionId: '',
    unboundKey: `agent:new:${crypto.randomUUID()}`,
    submissions: new Map<string, PendingAgentSubmission>(),
    createUncertain: false,
    createReviewed: false,
  }
}
export type AgentDraftMemory = ReturnType<typeof createAgentDraftMemory>
