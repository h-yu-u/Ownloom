import { computed, ref } from 'vue'
import type { WebSettings, WebSettingsUpdate, WebTestResult } from '@mlx-studio/api-client'
import type { SaveOutcome } from '../../shared/lib/save-outcome'
export interface WebSearchGateway {
  get(): Promise<WebSettings>
  save(value: WebSettingsUpdate): Promise<WebSettings>
  test(id: string, revision: number): Promise<WebTestResult>
}
type Verification =
  | { kind: 'untested' }
  | {
      kind: 'testing' | 'passed' | 'failed'
      configId: string
      revision: number
      elapsedMs?: number
      message?: string
      partial?: boolean
      sourceCount?: number
      readCount?: number
    }
export function createWebSearchController(gateway: WebSearchGateway) {
  const settings = ref<WebSettings | null>(null),
    baseUrl = ref('https://api.tavily.com'),
    apiKey = ref('')
  const loadPending = ref(false),
    savePending = ref(false),
    testPending = ref(false),
    error = ref('')
  const verification = ref<Verification>({ kind: 'untested' })
  const dirty = computed(
    () => baseUrl.value !== (settings.value?.baseUrl ?? 'https://api.tavily.com') || !!apiKey.value,
  )
  const pending = computed(() => loadPending.value || savePending.value || testPending.value)
  let epoch = 0
  const errorText = (cause: unknown) =>
    cause instanceof Error ? cause.message : '联网设置请求失败'
  function reset(): void {
    baseUrl.value = settings.value?.baseUrl ?? 'https://api.tavily.com'
    apiKey.value = ''
  }
  async function load(): Promise<void> {
    if (pending.value) return
    const owner = ++epoch,
      hadEdits = dirty.value
    loadPending.value = true
    error.value = ''
    try {
      const value = await gateway.get()
      if (owner !== epoch) return
      settings.value = value
      if (!hadEdits) reset()
      verification.value = { kind: 'untested' }
    } catch (cause) {
      if (owner === epoch) error.value = errorText(cause)
    } finally {
      if (owner === epoch) loadPending.value = false
    }
  }
  async function save(value?: WebSettingsUpdate): Promise<SaveOutcome<WebSettings>> {
    if (pending.value) return { kind: 'failed', message: '请等待当前操作完成', retryable: true }
    if (!settings.value) return { kind: 'failed', message: '请先读取已保存配置', retryable: true }
    if (!baseUrl.value.trim()) {
      error.value = '请输入服务地址'
      return { kind: 'invalid', fields: { baseUrl: error.value }, message: error.value }
    }
    savePending.value = true
    error.value = ''
    try {
      const saved = await gateway.save(
        value ?? {
          expected_revision: settings.value.revision,
          provider: 'tavily',
          base_url: baseUrl.value,
          ...(apiKey.value ? { api_key: apiKey.value } : {}),
        },
      )
      settings.value = saved
      reset()
      verification.value = { kind: 'untested' }
      return { kind: 'saved', value: saved }
    } catch (cause) {
      error.value = errorText(cause)
      return { kind: 'failed', message: error.value, retryable: true }
    } finally {
      savePending.value = false
    }
  }
  async function test(): Promise<boolean> {
    if (pending.value || dirty.value || !settings.value?.credentialConfigured) return false
    const config = { ...settings.value },
      owner = ++epoch
    testPending.value = true
    error.value = ''
    verification.value = { kind: 'testing', configId: config.id, revision: config.revision }
    try {
      const result = await gateway.test(config.id, config.revision)
      if (
        owner !== epoch ||
        settings.value?.id !== config.id ||
        settings.value?.revision !== config.revision
      )
        return false
      verification.value = {
        kind: result.ok ? 'passed' : 'failed',
        configId: config.id,
        revision: config.revision,
        elapsedMs: result.elapsedMs,
        partial: result.partial === true,
        sourceCount: result.sourceCount ?? undefined,
        readCount: result.readCount ?? undefined,
      }
      if (!result.ok) error.value = '此配置测试失败'
      return result.ok
    } catch (cause) {
      if (owner === epoch) {
        error.value = errorText(cause)
        verification.value = {
          kind: 'failed',
          configId: config.id,
          revision: config.revision,
          message: error.value,
        }
      }
      return false
    } finally {
      if (owner === epoch) testPending.value = false
    }
  }
  return {
    settings,
    baseUrl,
    apiKey,
    dirty,
    loadPending,
    savePending,
    testPending,
    pending,
    error,
    verification,
    load,
    save,
    test,
    reset,
  }
}
