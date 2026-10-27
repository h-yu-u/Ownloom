import { computed, ref } from 'vue'
import type {
  ExtensionCatalog,
  ExtensionScope,
  ExtensionSelection,
  ExtensionResolution,
} from '@mlx-studio/api-client'
import type { ExtensionsGateway } from '../application/ports'
import { SubmissionIdentity } from '../../requests'
import { extensionError } from './errors'
export function createSelectionController(gateway: ExtensionsGateway) {
  const catalog = ref<ExtensionCatalog | null>(null),
    selection = ref<ExtensionSelection>({ skillIds: [], toolIds: [], mediaBindings: {} }),
    preview = ref<ExtensionResolution | null>(null),
    error = ref(''),
    pending = ref(false)
  const identity = new SubmissionIdentity()
  const loaded = ref(false)
  const defaultLabel = computed(() =>
    scope.kind === 'project'
      ? '保存为当前项目默认'
      : scope.kind === 'session' && scope.scopeId === 'agent-default'
        ? '保存为工具助手默认'
        : '保存为此工作区默认',
  )
  let scope: ExtensionScope = { workspace: 'coding', kind: 'workspace', scopeId: 'default' },
    revision = 0,
    epoch = 0
  const skills = computed(
    () => catalog.value?.skills.filter((skill) => skill.workspaces.includes(scope.workspace)) ?? [],
  )
  const tools = computed(() =>
    scope.workspace === 'coding' || scope.kind === 'session'
      ? (catalog.value?.servers.flatMap((server) => {
          const inventory = catalog.value?.inventories.find(
            (item) => item.serverId === server.id && item.configRevision === server.revision,
          )
          return (
            inventory?.tools
              .filter((tool) => server.allowedTools.includes(tool.originalName))
              .map((tool) => ({
                ...tool,
                label: `${server.name} / ${tool.originalName}`,
                disabled: !server.enabled,
              })) ?? []
          )
        }) ?? [])
      : [],
  )
  const serverStates = computed(() =>
    (catalog.value?.servers ?? []).map((server) => ({
      id: server.id,
      name: server.name,
      enabled: server.enabled,
      selected: tools.value.filter(
        (tool) => selection.value.toolIds.includes(tool.id) && tool.serverId === server.id,
      ).length,
      tested:
        catalog.value?.inventories.some(
          (item) => item.serverId === server.id && item.configRevision === server.revision,
        ) ?? false,
    })),
  )
  async function load(value: ExtensionScope): Promise<void> {
    const owner = ++epoch
    scope = { ...value }
    loaded.value = false
    identity.clear()
    selection.value = { skillIds: [], toolIds: [], mediaBindings: {} }
    catalog.value = null
    preview.value = null
    pending.value = true
    error.value = ''
    try {
      const [items, binding] = await Promise.all([gateway.catalog(), gateway.binding(value)])
      if (owner !== epoch) return
      catalog.value = items
      revision = binding.revision
      selection.value = {
        ...binding.selection,
        mediaBindings: binding.selection.mediaBindings ?? {},
      }
      if (!binding.revision && value.kind !== 'workspace') {
        const fallback = await gateway.binding({
          workspace: value.workspace,
          kind: 'workspace',
          scopeId: 'default',
        })
        if (owner !== epoch) return
        selection.value = fallback.selection
      }
      selection.value.mediaBindings ??= {}
      loaded.value = true
    } catch (cause) {
      if (owner === epoch) error.value = extensionError(cause)
    } finally {
      if (owner === epoch) pending.value = false
    }
  }
  async function resolve(mode?: 'analyze' | 'develop' | 'review', agent = false): Promise<boolean> {
    const owner = epoch,
      requested = JSON.stringify(selection.value)
    error.value = ''
    preview.value = null
    try {
      const result = await gateway.resolve(scope, selection.value, mode, agent ? 'agent' : 'text')
      if (owner !== epoch) return false
      if (requested !== JSON.stringify(selection.value)) {
        error.value = '选择已改变，请重新应用'
        return false
      }
      preview.value = result
      return true
    } catch (cause) {
      if (owner === epoch) error.value = extensionError(cause)
      return false
    }
  }
  return {
    catalog,
    serverStates,
    defaultLabel,
    loaded,
    selection,
    skills,
    tools,
    preview,
    error,
    pending,
    load,
    resolve,
    async saveDefault() {
      if (!loaded.value || pending.value) return false
      pending.value = true
      const owner = epoch
      try {
        const scopeAtSubmit = { ...scope }
        const result = await gateway.saveBinding(
          scopeAtSubmit,
          revision,
          selection.value,
          identity.for({ scopeAtSubmit, revision, selection: selection.value }),
        )
        if (owner !== epoch) return false
        revision = result.revision
        identity.clear()
        return true
      } catch (cause) {
        if (owner === epoch) error.value = extensionError(cause)
        return false
      } finally {
        if (owner === epoch) pending.value = false
      }
    },
    dispose() {
      epoch++
    },
  }
}
