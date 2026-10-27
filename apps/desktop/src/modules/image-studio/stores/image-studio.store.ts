import { defineStore } from 'pinia'
import { configuredFactory } from '../../../shared/lib/configured-factory'
import type { createImageController } from '../presentation/image-controller'
const factory = configuredFactory<ReturnType<typeof createImageController>>()
export const configureImageWorkspace = factory.configure
export const useImageStudioStore = defineStore('image-studio', () => factory.create())
