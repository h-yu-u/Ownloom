import { defineStore } from 'pinia'
import { configuredFactory } from '../../shared/lib/configured-factory'
import type { createCodingSettingsController } from './controller'
const factory = configuredFactory<ReturnType<typeof createCodingSettingsController>>()
export const configureCodingSettings = factory.configure
export const useCodingSettings = defineStore('coding-settings', () => factory.create())
