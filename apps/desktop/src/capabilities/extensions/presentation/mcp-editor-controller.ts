import { ref } from 'vue'
import {
  RuntimeError,
  type ExtensionServer,
  type ExtensionMutation,
  type McpWriteRequest,
} from '@mlx-studio/api-client'
import type { ExtensionsGateway } from '../application/ports'
import type { SaveOutcome } from '../../../shared/lib/save-outcome'
import type { McpFormSnapshot } from './mcp-form-draft'
import { extensionError } from './errors'
export function createMcpEditorController(
  gateway: ExtensionsGateway,
  refresh: () => Promise<void>,
) {
  const savePending = ref(false),
    error = ref(''),
    locked = ref(false)
  const drafts = new Map<string, McpFormSnapshot>()
  let ticket: { body: McpWriteRequest; receipt?: ExtensionMutation } | undefined
  async function save(body: McpWriteRequest): Promise<SaveOutcome<ExtensionServer>> {
    if (savePending.value) return { kind: 'failed', message: '正在保存', retryable: true }
    savePending.value = true
    error.value = ''
    const recovering = !!ticket
    ticket ??= { body }
    try {
      if (!ticket.receipt) {
        if (recovering)
          ticket.receipt = (await gateway.mutation(ticket.body.mutationId)) ?? undefined
        if (!ticket.receipt) ticket.receipt = await gateway.saveServer(ticket.body)
      }
      const receipt = ticket.receipt
      let value: ExtensionServer
      try {
        value = await gateway.server(receipt.targetId)
        if (value.revision < receipt.revision) throw new Error('服务器配置尚未同步')
      } catch {
        locked.value = true
        error.value = '配置已保存，尚未同步；请重试同步，无需重新提交'
        return { kind: 'saved-pending-refresh', receipt, message: error.value }
      }
      ticket = undefined
      locked.value = false
      let refreshWarning: string | undefined
      try {
        await refresh()
      } catch {
        refreshWarning = '配置已保存，列表刷新失败，可重试刷新'
      }
      return { kind: 'saved', value, refreshWarning }
    } catch (cause) {
      error.value = extensionError(cause)
      if (!(cause instanceof RuntimeError) || cause.status === 0 || cause.status >= 500) {
        locked.value = true
        error.value = '提交结果未知；请恢复本次提交，避免重复创建'
        return { kind: 'uncertain', mutationId: body.mutationId, message: error.value }
      }
      ticket = undefined
      locked.value = false
      return { kind: 'failed', message: error.value, retryable: true }
    } finally {
      savePending.value = false
    }
  }
  function reset(): void {
    if (!ticket) error.value = ''
  }
  return { savePending, error, locked, save, reset, drafts }
}
