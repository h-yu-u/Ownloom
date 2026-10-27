import {
  RuntimeError,
  copyExtensionSelection,
  type ExtensionSelection,
} from '@mlx-studio/api-client'
import { ref, computed, type Ref } from 'vue'
import { ScopedTextDrafts } from '../../../shared/lib/scoped-text-drafts'
import type { SubmitOutcome } from '../../../shared/lib/submit-outcome'
import { SubmissionIdentity } from '../../../capabilities/requests'
import { submitCodingRun } from '../application/submit-coding-run'
import type { CodingGateway } from '../application/ports'
import type { CodingMode, CodingPermissionMode } from '../domain/status'
import { codingErrorText } from './coding-errors'
export function createCodingSubmission(deps: {
  gateway: CodingGateway
  projectId: Ref<string>
  sessionId: Ref<string>
  selectedModelId: Ref<string>
  mode: Ref<CodingMode>
  permissionMode: Readonly<Ref<CodingPermissionMode>>
  pending: Ref<boolean>
  busy: Ref<boolean>
  canSubmit(): boolean
  canSteer(): boolean
  error: Ref<string | null>
  guard<T>(action: () => Promise<T>): Promise<T | undefined>
  ensure(id: string, force?: boolean): Promise<void>
  invalidate(id: string): void
  refresh(): Promise<number>
  owner(): number
  owns(owner: number): boolean
}) {
  const verifyAfter = ref(true)
  const revision = ref(0),
    drafts = new ScopedTextDrafts(() => revision.value++)
  const key = computed(
    () => `coding:project:${deps.projectId.value}:session:${deps.sessionId.value || 'new'}`,
  )
  const text = computed({
    get: () => {
      void revision.value
      return drafts.get(key.value).text
    },
    set: (value: string) => {
      drafts.edit(key.value, value)
    },
  })
  const identity = new SubmissionIdentity()
  async function send(
    value = text.value,
    queue = false,
    selection?: ExtensionSelection,
  ): Promise<SubmitOutcome> {
    if (
      (deps.busy.value && !queue) ||
      deps.pending.value ||
      !deps.selectedModelId.value ||
      !deps.sessionId.value ||
      !value.trim() ||
      !deps.canSubmit()
    )
      return { kind: 'blocked', reason: '当前无法提交，请检查会话、模型和任务状态' }
    const draft = drafts.get(key.value),
      target = deps.sessionId.value,
      modelId = deps.selectedModelId.value,
      mode = deps.mode.value,
      permissionMode = mode === 'develop' ? deps.permissionMode.value : 'ask',
      owner = deps.owner()
    const selected = selection ? copyExtensionSelection(selection) : undefined
    const submissionId = identity.for({
      target,
      modelId,
      text: value,
      mode,
      permissionMode,
      queue,
      verifyAfter: verifyAfter.value,
      selected,
      draftId: draft.id,
      revision: draft.revision,
    })
    let outcome: SubmitOutcome = { kind: 'failed', acceptance: 'not-accepted', message: '提交失败' }
    await deps.guard(async () => {
      let sent = false
      try {
        const run = await submitCodingRun(
          {
            sessionId: target,
            modelId,
            text: value,
            mode,
            permissionMode,
            queue,
            verifyAfter: verifyAfter.value,
            selection: selected,
          },
          {
            gateway: {
              submit: (...args) => {
                sent = true
                return deps.gateway.submit(...args)
              },
            },
            ensure: deps.ensure,
            invalidate: deps.invalidate,
            createId: () => submissionId,
          },
        )
        if (draft.text === value) drafts.consume(draft)
        identity.clear()
        outcome = { kind: 'accepted', runId: run.id, submissionId, targetSessionId: target }
        if (deps.owns(owner)) {
          try {
            await deps.refresh()
          } catch (cause) {
            const warning = `任务已接纳，状态同步失败：${codingErrorText(cause)}`
            outcome = { ...outcome, syncWarning: warning }
            deps.error.value = warning
          }
        }
      } catch (cause) {
        const message = codingErrorText(cause)
        outcome =
          sent && (!(cause instanceof RuntimeError) || cause.status === 0 || cause.status >= 500)
            ? {
                kind: 'failed',
                acceptance: 'unknown',
                submissionId,
                targetSessionId: target,
                message,
              }
            : { kind: 'failed', acceptance: 'not-accepted', message }
        throw cause
      }
    })
    return outcome
  }
  async function steer(value = text.value): Promise<boolean> {
    if (!deps.canSteer() || !activeRunId() || deps.pending.value || !value.trim()) return false
    const draft = drafts.get(key.value),
      owner = deps.owner()
    return !!(await deps.guard(async () => {
      // No automatic replay: steer has no server submission identity.
      try {
        await deps.gateway.steer(activeRunId(), value)
      } catch (cause) {
        if (!(cause instanceof RuntimeError) || cause.status === 0 || cause.status >= 500) {
          if (deps.owns(owner)) {
            try {
              await deps.refresh()
            } catch {
              deps.error.value = '追加结果未知，状态尚未同步，请重新连接后确认'
            }
          }
          throw new Error('追加结果未知，草稿已保留；请确认任务状态后再操作')
        }
        throw cause
      }
      if (draft.text === value) drafts.consume(draft)
      try {
        if (deps.owns(owner)) await deps.refresh()
      } catch (cause) {
        if (deps.owns(owner))
          deps.error.value = `追加已接纳，状态同步失败：${codingErrorText(cause)}`
      }
      return true
    }))
  }
  let activeRunId = () => ''
  return {
    verifyAfter,
    text,
    send,
    steer,
    drafts,
    setActiveRun: (get: () => string) => {
      activeRunId = get
    },
  }
}
