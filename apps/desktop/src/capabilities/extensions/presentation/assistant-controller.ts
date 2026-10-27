import { SubmissionIdentity } from '../../requests'
import { computed, ref, type Ref } from 'vue'
import type {
  ModelSummary,
  TextAssistantRequest,
  TextAssistantView,
  textAssistantEndpoints,
} from '@mlx-studio/api-client'
import { extensionError } from './errors'
export interface AssistantDependencies {
  gateway: ReturnType<typeof textAssistantEndpoints>
  models: Readonly<Ref<readonly ModelSummary[]>>
  refreshModels(): Promise<void>
}
export function createAssistantController(deps: AssistantDependencies) {
  const modelId = ref(''),
    pending = ref(false),
    error = ref(''),
    draft = ref(''),
    job = ref<TextAssistantView | null>(null)
  const models = computed(() =>
    deps.models.value
      .filter((model) => model.outputModalities.includes('text'))
      .map((model) => ({ label: model.displayName, value: model.id })),
  )
  const identity = new SubmissionIdentity()
  let epoch = 0
  async function generate(
    input: Omit<TextAssistantRequest, 'modelId' | 'submissionId'>,
  ): Promise<void> {
    if (pending.value) return
    const owner = ++epoch
    pending.value = true
    error.value = ''
    try {
      const first = await deps.gateway.create({
        ...input,
        modelId: modelId.value,
        submissionId: identity.for({ ...input, modelId: modelId.value }),
      })
      if (owner !== epoch) return
      job.value = first
      while (['queued', 'preparing', 'running', 'cancelling'].includes(job.value.state)) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        if (owner !== epoch) return
        const next = await deps.gateway.get(job.value.jobId)
        if (owner !== epoch) return
        job.value = next
      }
      if (job.value.state === 'succeeded') {
        draft.value = job.value.text
        identity.clear()
      } else if (job.value.errorCode) error.value = extensionError(new Error(job.value.errorCode))
    } catch (cause) {
      if (owner === epoch) error.value = extensionError(cause)
    } finally {
      if (owner === epoch) pending.value = false
    }
  }
  return {
    modelId,
    pending,
    error,
    draft,
    job,
    models,
    generate,
    async load() {
      await deps.refreshModels()
      if (!modelId.value) modelId.value = models.value[0]?.value ?? ''
    },
    async cancel() {
      try {
        if (job.value) job.value = await deps.gateway.cancel(job.value.jobId)
      } catch (cause) {
        error.value = extensionError(cause)
      }
    },
    dispose() {
      epoch++
    },
  }
}
