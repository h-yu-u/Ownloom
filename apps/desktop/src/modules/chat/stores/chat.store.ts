import { defineStore } from 'pinia'
import { configuredFactory } from '../../../shared/lib/configured-factory'
import type { createChatController } from '../presentation/chat-controller'
const factory = configuredFactory<ReturnType<typeof createChatController>>()
export const configureChatWorkspace = factory.configure
export const useChatStore = defineStore('chat', () => factory.create())
