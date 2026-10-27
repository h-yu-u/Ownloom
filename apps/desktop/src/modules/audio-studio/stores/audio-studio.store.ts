import { defineStore } from 'pinia'
import { configuredFactory } from '../../../shared/lib/configured-factory'
import type { createAudioController } from '../presentation/audio-controller'
const factory = configuredFactory<ReturnType<typeof createAudioController>>()
export const configureAudioWorkspace = factory.configure
export const useAudioStudioStore = defineStore('audio-studio', () => factory.create())
