import { RuntimeSession } from '@mlx-studio/api-client'
import { type RuntimeClient, type RuntimeConnection } from '@mlx-studio/api-client'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { readonly, ref } from 'vue'

export type RuntimeConnectionStatus = 'starting' | 'ready' | 'failed'

interface RuntimeStatusEvent {
  status: RuntimeConnectionStatus
  generation: number
  message?: string | null
}

let lastGeneration = 0
let listenerReady: Promise<UnlistenFn | undefined> | undefined

const status = ref<RuntimeConnectionStatus>('starting')
const error = ref<string | null>(null)

export const runtimeConnectionStatus = readonly(status)
export const runtimeConnectionError = readonly(error)

const session = new RuntimeSession(
  async () => {
    await ensureRuntimeListener()
    return isTauri() ? invoke<RuntimeConnection>('runtime_connection') : browserConnection()
  },
  (nextStatus, message) => {
    status.value = nextStatus
    error.value = message
  },
)

export function runtimeClient(): Promise<RuntimeClient> {
  return session.get()
}

export async function restartRuntimeProcess(): Promise<RuntimeClient> {
  if (!isTauri()) throw new Error('浏览器调试模式无法重启桌面 Runtime')
  invalidate('正在重启 Runtime', 'starting')
  try {
    await invoke('restart_runtime_process')
    return await runtimeClient()
  } catch (cause) {
    invalidate(cause instanceof Error ? cause.message : 'Runtime 重启失败')
    throw cause
  }
}

export function currentConnection(): RuntimeConnection | undefined {
  return session.connection
}

async function ensureRuntimeListener(): Promise<void> {
  if (!isTauri()) return
  if (!listenerReady) {
    listenerReady = listen<RuntimeStatusEvent>('runtime-status', ({ payload }) => {
      if (!payload || typeof payload !== 'object' || payload.generation < lastGeneration) return
      lastGeneration = payload.generation
      if (payload.status === 'failed') {
        invalidate(payload.message ?? 'Runtime 已退出')
        return
      }
      if (payload.status === 'starting') {
        invalidate(null, 'starting')
        return
      }
      if (
        session.connection?.generation !== undefined &&
        session.connection.generation !== payload.generation
      ) {
        invalidate(null, 'starting')
      }
      status.value = 'ready'
      error.value = null
    })
  }
  await listenerReady
}

function browserConnection(): RuntimeConnection {
  const baseUrl = import.meta.env.VITE_RUNTIME_URL
  const token = import.meta.env.VITE_RUNTIME_TOKEN
  if (!baseUrl || !token) {
    throw new Error('请从桌面应用启动，或配置本地开发 Runtime 地址')
  }
  return { baseUrl, token, protocolVersion: 1, generation: 1 }
}

function invalidate(message: string | null, nextStatus: RuntimeConnectionStatus = 'failed'): void {
  session.invalidate(message, nextStatus)
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function canRestartRuntime(): boolean {
  return isTauri()
}
