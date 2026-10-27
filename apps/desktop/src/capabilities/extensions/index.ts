export {
  configureExtensions,
  createExtensionsSettings,
  createCapabilitySelection,
} from './configuration'
export { default as CapabilityPicker } from './presentation/CapabilityPicker.vue'
export { default as ExtensionsSettings } from './presentation/ExtensionsSettings.vue'
export type { ExtensionSelection, ExtensionScope } from '@mlx-studio/api-client'

export { default as TextAssistant } from './presentation/TextAssistant.vue'

export { default as AgentChat } from './presentation/AgentChat.vue'
export { default as ArtifactLinks } from './presentation/ArtifactLinks.vue'
