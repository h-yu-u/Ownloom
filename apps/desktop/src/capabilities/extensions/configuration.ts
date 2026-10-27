import type { createAgentController } from './presentation/agent-controller'
import type { createAssistantController } from './presentation/assistant-controller'
import type { createExtensionsController } from './presentation/controller'
import type { createSelectionController } from './presentation/selection-controller'
let agent: (() => ReturnType<typeof createAgentController>) | undefined
let assistant: (() => ReturnType<typeof createAssistantController>) | undefined
let settings: (() => ReturnType<typeof createExtensionsController>) | undefined
let picker: (() => ReturnType<typeof createSelectionController>) | undefined
export function configureExtensions(factories: {
  agent: NonNullable<typeof agent>
  assistant: NonNullable<typeof assistant>
  settings: NonNullable<typeof settings>
  picker: NonNullable<typeof picker>
}): void {
  agent = factories.agent
  assistant = factories.assistant
  settings = factories.settings
  picker = factories.picker
}
export function createExtensionsSettings() {
  if (!settings) throw new Error('Extensions not configured')
  return settings()
}
export function createCapabilitySelection() {
  if (!picker) throw new Error('Extensions not configured')
  return picker()
}

export function createTextAssistant() {
  if (!assistant) throw new Error('Assistant not configured')
  return assistant()
}

export function createAgentChat() {
  if (!agent) throw new Error('Agent Chat not configured')
  return agent()
}
