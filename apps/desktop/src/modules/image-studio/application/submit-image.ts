import { buildImageRequest, type ImageDraft } from '../domain/image-state'
import type { ImageGateway } from './ports'
export class SubmitImage {
  private running = false
  private retry?: { key: string; id: string }
  constructor(private readonly gateway: Pick<ImageGateway, 'generate'>) {}
  async run(draft: ImageDraft) {
    if (this.running) return undefined
    this.running = true
    try {
      const request = buildImageRequest(draft)
      const key = JSON.stringify(request)
      if (this.retry?.key !== key) this.retry = { key, id: crypto.randomUUID() }
      const job = await this.gateway.generate({ ...request, client_request_id: this.retry.id })
      this.retry = undefined
      return job
    } finally {
      this.running = false
    }
  }
}
