import { configuredFactory } from '../../shared/lib/configured-factory'
import type { AssetCatalog } from './application/asset-catalog'
const catalog = configuredFactory<AssetCatalog>()
export const configureMediaAssets = catalog.configure
export const createMediaAssets = catalog.create
