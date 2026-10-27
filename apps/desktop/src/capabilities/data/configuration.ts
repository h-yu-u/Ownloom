import { configuredFactory } from '../../shared/lib/configured-factory'
import type { createDataController } from './controller'
const factory = configuredFactory<ReturnType<typeof createDataController>>()
export const configureDataManagement = factory.configure
export const createDataManagement = factory.create
