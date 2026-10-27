import { defineStore } from 'pinia'
import { configuredFactory } from '../../shared/lib/configured-factory'
import type { createTaskCenter } from './controller'
const factory = configuredFactory<ReturnType<typeof createTaskCenter>>()
export const configureTaskCenter = factory.configure
export const useTaskCenter = defineStore('task-center', () => factory.create())
