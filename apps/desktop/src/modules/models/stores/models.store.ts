import { defineStore } from 'pinia'
import { configuredFactory } from '../../../shared/lib/configured-factory'
import type { createModelsController } from '../presentation/models-controller'
const factory = configuredFactory<ReturnType<typeof createModelsController>>()
export const configureModelsWorkspace = factory.configure
export const useModelsStore = defineStore('models', () => factory.create())
