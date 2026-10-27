import { defineStore } from 'pinia'
import { configuredFactory } from '../../shared/lib/configured-factory'
import type { createRuntimeController } from './controller'
const factory = configuredFactory<ReturnType<typeof createRuntimeController>>()
export const configureRuntimeOverview = factory.configure
export const useRuntimeStore = defineStore('runtime-overview', () => factory.create())
