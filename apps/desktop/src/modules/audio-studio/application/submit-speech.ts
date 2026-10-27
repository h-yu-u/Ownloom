import type { ModelSummary } from '@mlx-studio/api-client'
import type { AudioGateway, AudioJob, SpeechDraft } from './ports'
import { buildSpeechRequest } from './speech-request'

/** The use case owns retry identity; the controller owns view lifetimes. */
export class SubmitSpeech {
  private generation = 0
  private retry?: { key: string; id: string }
  constructor(
    private gateway: Pick<AudioGateway, 'generate'>,
    private createId: () => string,
  ) {}
  async execute(draft: SpeechDraft, models: readonly ModelSummary[]): Promise<AudioJob> {
    const owner = ++this.generation
    const request = buildSpeechRequest(draft, models)
    const key = JSON.stringify(request)
    if (this.retry?.key !== key) this.retry = { key, id: this.createId() }
    const job = await this.gateway.generate({ ...request, clientRequestId: this.retry.id })
    if (owner === this.generation) this.retry = undefined
    return job
  }
}
