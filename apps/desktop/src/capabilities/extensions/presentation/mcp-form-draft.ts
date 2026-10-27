import { computed, ref, watch } from 'vue'
import type { ExtensionServer, ExtensionInventory, McpWriteRequest } from '@mlx-studio/api-client'
import type { SaveOutcome } from '../../../shared/lib/save-outcome'
import { SubmissionIdentity } from '../../requests'
import { parsePublicMcpDraft } from './mcp-config'
export interface McpFormSnapshot {
  name: string
  type: 'stdio' | 'streamable-http'
  executable: string
  args: string
  cwd: string
  url: string
  publicValues: string
  enabled: boolean
  credentialAction: 'keep' | 'replace' | 'clear'
  credentialKind: 'bearer' | 'api-key' | 'env'
  credentialField: string
  secret: string
  allowed: string[]
  readOnly: string[]
}
export interface McpFormProps {
  server: ExtensionServer | null
  inventory?: ExtensionInventory
  pending: boolean
  memory?: Map<string, McpFormSnapshot>
  locked?: boolean
  saveRequest(value: McpWriteRequest): Promise<SaveOutcome<ExtensionServer>>
}
export function createMcpForm(props: McpFormProps) {
  const identity = new SubmissionIdentity()
  const name = ref(''),
    type = ref<'stdio' | 'streamable-http'>('stdio'),
    executable = ref(''),
    args = ref('[]'),
    cwd = ref(''),
    url = ref(''),
    publicValues = ref('{}'),
    enabled = ref(false)
  const credentialAction = ref<'keep' | 'replace' | 'clear'>('keep'),
    credentialKind = ref<'bearer' | 'api-key' | 'env'>('env'),
    credentialField = ref('API_KEY'),
    secret = ref(''),
    error = ref('')
  const allowed = ref<string[]>([]),
    readOnly = ref<string[]>([])
  const discovered = computed(() => props.inventory?.tools ?? [])
  const importedJson = ref('')
  function importJson(): void {
    try {
      const draft = parsePublicMcpDraft(importedJson.value)
      name.value = draft.name
      enabled.value = draft.enabled ?? false
      allowed.value = draft.allowedTools ?? []
      readOnly.value = draft.readOnlyTools ?? []
      type.value = draft.transport.type
      if (draft.transport.type === 'stdio') {
        executable.value = draft.transport.executable
        args.value = JSON.stringify(draft.transport.args)
        cwd.value = draft.transport.cwd
        publicValues.value = JSON.stringify(draft.transport.publicEnv, null, 2)
      } else {
        url.value = draft.transport.url
        publicValues.value = JSON.stringify(draft.transport.publicHeaders, null, 2)
      }
      error.value = ''
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '配置格式不正确'
    }
  }
  watch(
    type,
    (value) => {
      credentialKind.value = value === 'stdio' ? 'env' : 'bearer'
      credentialField.value = value === 'stdio' ? 'API_KEY' : 'Authorization'
    },
    { flush: 'sync' },
  )
  let currentKey = '',
    restoring = false
  function snapshot(): McpFormSnapshot {
    return {
      name: name.value,
      type: type.value,
      executable: executable.value,
      args: args.value,
      cwd: cwd.value,
      url: url.value,
      publicValues: publicValues.value,
      enabled: enabled.value,
      credentialAction: credentialAction.value,
      credentialKind: credentialKind.value,
      credentialField: credentialField.value,
      secret: secret.value,
      allowed: [...allowed.value],
      readOnly: [...readOnly.value],
    }
  }
  function restore(value: McpFormSnapshot): void {
    type.value = value.type
    name.value = value.name
    executable.value = value.executable
    args.value = value.args
    cwd.value = value.cwd
    url.value = value.url
    publicValues.value = value.publicValues
    enabled.value = value.enabled
    credentialAction.value = value.credentialAction
    credentialKind.value = value.credentialKind
    credentialField.value = value.credentialField
    secret.value = value.secret
    allowed.value = [...value.allowed]
    readOnly.value = [...value.readOnly]
  }
  watch(
    [
      name,
      type,
      executable,
      args,
      cwd,
      url,
      publicValues,
      enabled,
      credentialAction,
      credentialKind,
      credentialField,
      secret,
      allowed,
      readOnly,
    ],
    () => {
      if (!restoring && currentKey) props.memory?.set(currentKey, snapshot())
    },
    { deep: true, flush: 'sync' },
  )
  watch(
    () => props.server,
    (server) => {
      restoring = true
      currentKey = server?.id ?? 'new'
      const cached = props.memory?.get(currentKey)
      name.value = server?.name ?? ''
      enabled.value = server?.enabled ?? false
      allowed.value = [...(server?.allowedTools ?? [])]
      readOnly.value = [...(server?.readOnlyTools ?? [])]
      const transport = server?.transport
      type.value = transport?.type ?? 'stdio'
      executable.value = transport?.type === 'stdio' ? transport.executable : ''
      cwd.value = transport?.type === 'stdio' ? transport.cwd : ''
      args.value = JSON.stringify(transport?.type === 'stdio' ? transport.args : [])
      url.value = transport?.type === 'streamable-http' ? transport.url : ''
      publicValues.value = JSON.stringify(
        transport?.type === 'stdio' ? transport.publicEnv : (transport?.publicHeaders ?? {}),
        null,
        2,
      )
      credentialAction.value = 'keep'
      credentialKind.value =
        transport?.type === 'streamable-http'
          ? transport.authMode === 'api-key'
            ? 'api-key'
            : 'bearer'
          : 'env'
      credentialField.value =
        Object.keys(transport?.secretRefs ?? {})[0] ??
        (type.value === 'stdio' ? 'API_KEY' : 'Authorization')
      identity.clear()
      secret.value = ''
      error.value = ''
      if (cached) restore(cached)
      restoring = false
    },
    { immediate: true },
  )
  function toggle(values: string[], name: string, checked: boolean): string[] {
    return checked ? [...new Set([...values, name])] : values.filter((item) => item !== name)
  }
  function publicMap(text: string): Record<string, string> {
    const value: unknown = JSON.parse(text)
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.values(value).some((item) => typeof item !== 'string')
    )
      throw new Error('公开配置必须是字符串键值对象')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]))
  }
  async function save(): Promise<void> {
    if (props.pending) return
    error.value = ''
    try {
      const values = publicMap(publicValues.value),
        argv: unknown = JSON.parse(args.value)
      if (!Array.isArray(argv) || argv.some((item) => typeof item !== 'string'))
        throw new Error('参数必须是 JSON 字符串数组')
      const transport =
        type.value === 'stdio'
          ? {
              type: type.value,
              executable: executable.value,
              args: argv.map(String),
              cwd: cwd.value,
              publicEnv: values,
            }
          : {
              type: type.value,
              url: url.value,
              publicHeaders: values,
              authMode:
                credentialAction.value === 'replace'
                  ? credentialKind.value === 'bearer'
                    ? ('bearer' as const)
                    : ('api-key' as const)
                  : props.server?.transport.type === 'streamable-http'
                    ? props.server.transport.authMode
                    : ('none' as const),
            }
      const credential =
        credentialAction.value === 'replace'
          ? {
              action: 'replace' as const,
              field: credentialField.value,
              kind: credentialKind.value,
              value: secret.value,
            }
          : credentialAction.value === 'clear'
            ? { action: 'clear' as const, field: credentialField.value }
            : { action: 'keep' as const }
      const intent = {
        ...(props.server ? { id: props.server.id } : {}),
        expectedRevision: props.server?.revision ?? 0,
        name: name.value,
        enabled: enabled.value,
        transport,
        credential,
        allowedTools: allowed.value,
        readOnlyTools: readOnly.value.filter((item) => allowed.value.includes(item)),
      }
      const result = await props.saveRequest({ ...intent, mutationId: identity.for(intent) })
      if (result.kind === 'saved') {
        secret.value = ''
        identity.clear()
      } else error.value = result.message
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '配置格式不正确'
    }
  }
  return {
    name,
    type,
    executable,
    args,
    cwd,
    url,
    publicValues,
    enabled,
    credentialAction,
    credentialKind,
    credentialField,
    secret,
    error,
    allowed,
    readOnly,
    discovered,
    importedJson,
    importJson,
    toggle,
    save,
  }
}
