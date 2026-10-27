import { ref } from 'vue'
import type {
  ExtensionCatalog,
  ExtensionOperation,
  ExtensionServer,
  SkillInspection,
  SkillImportRequest,
} from '@mlx-studio/api-client'
import { createMcpEditorController } from './mcp-editor-controller'
import type { ExtensionsGateway } from '../application/ports'
import { extensionError } from './errors'
export function createExtensionsController(
  gateway: ExtensionsGateway,
  pickDirectory: () => Promise<string | null>,
) {
  const catalog = ref<ExtensionCatalog | null>(null),
    pending = ref(false),
    error = ref(''),
    operation = ref<ExtensionOperation | null>(null),
    operations = ref<Record<string, ExtensionOperation>>({}),
    operationRevisions = ref<Record<string, number>>({}),
    inspection = ref<SkillInspection | null>(null),
    importPreview = ref<SkillInspection | null>(null)
  let importRequest: SkillImportRequest | undefined
  let epoch = 0
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    const owner = epoch
    pending.value = true
    error.value = ''
    try {
      const result = await action()
      return owner === epoch ? result : undefined
    } catch (cause) {
      if (owner === epoch) error.value = extensionError(cause)
      return undefined
    } finally {
      if (owner === epoch) pending.value = false
    }
  }
  async function load(): Promise<void> {
    const value = await run(gateway.catalog)
    if (value && (!catalog.value || value.catalogRevision >= catalog.value.catalogRevision))
      catalog.value = value
  }
  async function test(server: ExtensionServer): Promise<void> {
    const owner = epoch
    const first = await run(() => gateway.test(server.id, server.revision))
    if (!first) return
    operation.value = first
    operations.value[server.id] = first
    operationRevisions.value[server.id] = server.revision
    while (owner === epoch && operation.value?.state === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 300))
      if (owner !== epoch) return
      const next = await run(() => gateway.operation(first.id))
      if (!next) return
      operation.value = next
      operations.value[server.id] = next
    }
    const code = operation.value?.errorCode
    await load()
    if (code) error.value = extensionError(new Error(code))
  }
  const editor = createMcpEditorController(gateway, async () => {
    const value = await gateway.catalog()
    catalog.value = value
  })
  return {
    editor,
    saveServer: editor.save,
    catalog,
    pending,
    error,
    operation,
    operations,
    operationRevisions,
    inspection,
    load,
    test,
    async inspect(id: string) {
      const result = await run(() => gateway.skill(id))
      if (result) inspection.value = result
    },
    async importSkill(
      workspaces: ('chat' | 'coding' | 'image' | 'audio')[],
      existing?: { id: string; revision: number },
    ): Promise<void> {
      const path = await pickDirectory()
      if (!path) return
      importRequest = {
        mutationId: crypto.randomUUID(),
        path,
        workspaces,
        requiredCapabilities: [],
        ...(existing ? { id: existing.id, expectedRevision: existing.revision } : {}),
      }
      const result = await run(() => gateway.previewSkill(importRequest!))
      if (result) importPreview.value = result
    },
    importPreview,
    async publishImport() {
      if (!importRequest || !importPreview.value) return
      const result = await run(() =>
        gateway.importSkill({
          ...importRequest!,
          expectedDigest: importPreview.value!.skill.digest,
        }),
      )
      if (result) {
        importPreview.value = null
        importRequest = undefined
        await load()
      }
    },
    async toggle(id: string, revision: number, enabled: boolean) {
      if (await run(() => gateway.toggleSkill(id, revision, enabled))) await load()
    },
    async revoke(id: string) {
      if (await run(() => gateway.revoke(id))) await load()
    },
    async cancelTest() {
      if (operation.value) {
        const next = await run(() => gateway.cancelOperation(operation.value!.id))
        if (next) {
          operation.value = next
          operations.value[next.serverId] = next
        }
      }
    },
    dispose() {
      epoch++
      pending.value = false
    },
  }
}
