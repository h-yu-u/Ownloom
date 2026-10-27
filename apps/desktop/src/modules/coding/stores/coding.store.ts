import { defineStore } from 'pinia'
import { configuredFactory } from '../../../shared/lib/configured-factory'
import type { createCodingController } from '../presentation/coding-controller'
const workspace = configuredFactory<ReturnType<typeof createCodingController>>()
export const configureCodingWorkspace = workspace.configure
export const useCodingStore = defineStore('coding', () => workspace.create())
