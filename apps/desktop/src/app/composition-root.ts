import { dataEndpoints } from '@mlx-studio/api-client'
import { configureTaskCenter } from '../capabilities/tasks/store'
import { createTaskCenter } from '../capabilities/tasks/controller'
import { configureDataManagement } from '../capabilities/data/configuration'
import { createDataController } from '../capabilities/data/controller'
import { configureMediaAssets } from '../capabilities/media'
import { createAssetCatalog } from '../capabilities/media/infrastructure/asset-catalog'
import { createAgentDraftMemory } from '../capabilities/extensions/presentation/agent-draft-memory'
import { createAgentController } from '../capabilities/extensions/presentation/agent-controller'
import { agentChatEndpoints } from '@mlx-studio/api-client'
import { createAssistantController } from '../capabilities/extensions/presentation/assistant-controller'
import { textAssistantEndpoints } from '@mlx-studio/api-client'
import { configureExtensions } from '../capabilities/extensions'
import { createExtensionsGateway } from '../capabilities/extensions/infrastructure/gateway'
import { createExtensionsController } from '../capabilities/extensions/presentation/controller'
import { createSelectionController } from '../capabilities/extensions/presentation/selection-controller'
import { pickSkillDirectory } from '../platform/files'
import { configureCodingSettings } from '../capabilities/coding-settings/store'
import { createCodingSettingsController } from '../capabilities/coding-settings/controller'
import { createCodingSettingsGateway } from '../capabilities/coding-settings/gateway'
import { configureCodingWorkspace } from '../modules/coding/stores/coding.store'
import { createCodingController } from '../modules/coding/presentation/coding-controller'
import { createCodingGateway } from '../modules/coding/infrastructure/coding-gateway'
import { observeCoding } from '../modules/coding/presentation/coding-observer'
import { configureChatWorkspace } from '../modules/chat/stores/chat.store'
import { configureImageWorkspace } from '../modules/image-studio/stores/image-studio.store'
import { configureAudioWorkspace } from '../modules/audio-studio/stores/audio-studio.store'
import { createAudioController } from '../modules/audio-studio/presentation/audio-controller'
import { createAudioGateway } from '../modules/audio-studio/infrastructure/audio-gateway'
import { configureModelsWorkspace } from '../modules/models/stores/models.store'
import { configureRuntimeOverview } from '../capabilities/runtime/store'
import { createRuntimeController } from '../capabilities/runtime/controller'
import { createRuntimeGateway } from '../capabilities/runtime/gateway'
import { toRef } from 'vue'
import { createEndpoints } from '@mlx-studio/api-client'
import {
  runtimeClient,
  restartRuntimeProcess,
  runtimeConnectionStatus,
} from '../platform/runtime-bridge'
import { useModelDirectory } from '../capabilities/models'
import { JobObserver } from '../capabilities/jobs/job-observer'
import { createChatGateway } from '../modules/chat/infrastructure/chat-gateway'
import { createChatController } from '../modules/chat/presentation/chat-controller'
import { createImageGateway } from '../modules/image-studio/infrastructure/image-gateway'
import { createImageController } from '../modules/image-studio/presentation/image-controller'
import { createModelsGateway } from '../modules/models/infrastructure/models-gateway'
import { createModelsController } from '../modules/models/presentation/models-controller'
import {
  exportBackup,
  exportBlob,
  pickModelDirectory,
  pickProjectDirectory,
} from '../platform/files'
import { createAttachmentGateway } from '../modules/chat/infrastructure/attachment-gateway'
import { createChatDraftController } from '../modules/chat/presentation/chat-draft-controller'
import { configureWebSearch } from '../capabilities/web-search/store'
import { createWebSearchController } from '../capabilities/web-search/controller'
import { createWebSearchGateway } from '../capabilities/web-search/gateway'

const observer = new JobObserver(runtimeClient)
function directoryDependencies() {
  const directory = useModelDirectory()
  return {
    directory,
    refreshModels: () =>
      directory.refresh(async () => createEndpoints(await runtimeClient()).models.list()),
  }
}
export function createChatWorkspace() {
  const { directory, refreshModels } = directoryDependencies()
  const gateway = createChatGateway(runtimeClient)
  return createChatController({
    runtimeAvailable: () => runtimeConnectionStatus.value === 'ready',
    gateway,
    draftFactory: (conversation) =>
      createChatDraftController(
        conversation,
        createAttachmentGateway(runtimeClient),
        (id, enabled) => gateway.update(id, { web_search_enabled: enabled }),
      ),
    models: toRef(directory, 'items'),
    refreshModels,
    exportText: (content, filename) =>
      exportBlob(new Blob([content], { type: 'text/markdown;charset=utf-8' }), filename),
    observe: (id, after, event, resync) => observer.watch(id, after, { event, resync }),
  })
}
export function createImageWorkspace() {
  return createImageController({
    ...directoryDependencies(),
    gateway: createImageGateway(runtimeClient),
    exportImage: (blob, id) => exportBlob(blob, `ownloom-${id}.png`),
  })
}
export function createModelsWorkspace() {
  return createModelsController({
    directory: useModelDirectory(),
    gateway: createModelsGateway(runtimeClient),
    pickDirectory: pickModelDirectory,
  })
}

export function createAudioWorkspace() {
  return createAudioController({
    ...directoryDependencies(),
    gateway: createAudioGateway(runtimeClient),
    exportAudio: (blob, id) => exportBlob(blob, `ownloom-${id}.wav`),
  })
}

export function createRuntimeOverview() {
  return createRuntimeController({
    gateway: createRuntimeGateway(runtimeClient),
    exportFile: exportBlob,
  })
}

export function createCodingWorkspace() {
  const { directory, refreshModels } = directoryDependencies()
  return createCodingController({
    runtimeAvailable: () => runtimeConnectionStatus.value === 'ready',
    gateway: createCodingGateway(runtimeClient),
    models: toRef(directory, 'items'),
    refreshModels,
    pickDirectory: pickProjectDirectory,
    observe: (after, refresh, fail, apply) =>
      observeCoding(runtimeClient, after, refresh, fail, apply),
  })
}

export function installWorkspaces(): void {
  configureTaskCenter(() =>
    createTaskCenter({
      refreshModels: directoryDependencies().refreshModels,
      tasks: async (signal) => dataEndpoints(await runtimeClient()).tasks(signal),
      download: async (id, action) =>
        dataEndpoints(await runtimeClient()).downloadAction(id, action),
    }),
  )
  configureDataManagement(() =>
    createDataController({
      storage: async () => dataEndpoints(await runtimeClient()).storage(),
      cleanup: async () => dataEndpoints(await runtimeClient()).cleanup(),
      restore: async (id) => dataEndpoints(await runtimeClient()).restore(id),
      inspect: async (file) => (await runtimeClient()).inspectBackup(file),
      activate: async (id) => dataEndpoints(await runtimeClient()).activateProfile(id),
      rollback: async () => dataEndpoints(await runtimeClient()).rollbackProfile(),
      restart: restartRuntimeProcess,
      backup: async () => exportBackup(async () => (await runtimeClient()).downloadBackup()),
    }),
  )
  configureMediaAssets(() => createAssetCatalog(runtimeClient))
  const extensionGateway = createExtensionsGateway(runtimeClient)
  const agentMemory = createAgentDraftMemory()
  const extensionSettings = createExtensionsController(extensionGateway, pickSkillDirectory)
  configureExtensions({
    agent: () =>
      createAgentController({
        runtimeAvailable: () => runtimeConnectionStatus.value === 'ready',
        memory: agentMemory,
        models: toRef(useModelDirectory(), 'items'),
        refreshModels: directoryDependencies().refreshModels,
        verifyModel: async (id) => {
          const endpoints = createEndpoints(await runtimeClient())
          const caps = await endpoints.coding.capabilities()
          if (!caps.some((cap) => cap.id === id && cap.status === 'verified'))
            await endpoints.coding.verifyModel(id)
        },
        gateway: {
          events: async (...args) => agentChatEndpoints(await runtimeClient()).events(...args),
          sessions: async () => agentChatEndpoints(await runtimeClient()).sessions(),
          create: async (...args) => agentChatEndpoints(await runtimeClient()).create(...args),
          snapshot: async (...args) => agentChatEndpoints(await runtimeClient()).snapshot(...args),
          submit: async (...args) => agentChatEndpoints(await runtimeClient()).submit(...args),
          cancel: async (...args) => agentChatEndpoints(await runtimeClient()).cancel(...args),
          resolve: async (...args) => agentChatEndpoints(await runtimeClient()).resolve(...args),
        },
      }),
    assistant: () =>
      createAssistantController({
        models: toRef(useModelDirectory(), 'items'),
        refreshModels: directoryDependencies().refreshModels,
        gateway: {
          create: async (body) => textAssistantEndpoints(await runtimeClient()).create(body),
          get: async (id) => textAssistantEndpoints(await runtimeClient()).get(id),
          cancel: async (id) => textAssistantEndpoints(await runtimeClient()).cancel(id),
        },
      }),
    settings: () => extensionSettings,
    picker: () => createSelectionController(extensionGateway),
  })
  configureWebSearch(() => createWebSearchController(createWebSearchGateway(runtimeClient)))
  configureCodingSettings(() =>
    createCodingSettingsController(createCodingSettingsGateway(runtimeClient)),
  )
  configureCodingWorkspace(createCodingWorkspace)
  configureChatWorkspace(createChatWorkspace)
  configureImageWorkspace(createImageWorkspace)
  configureAudioWorkspace(createAudioWorkspace)
  configureModelsWorkspace(createModelsWorkspace)
  configureRuntimeOverview(createRuntimeOverview)
}
