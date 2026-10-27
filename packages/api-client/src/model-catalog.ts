import type { components } from './generated-schema'
import { list, record, text, number, nullableText, malformed } from './decoders'
type HubModelOption = components['schemas']['HubModelOption']
export function decodeCatalog(value: unknown): HubModelOption[] {
  return list(value, (value) => {
    const item = record(value)
    const repo = text(item.repo_id)
    const downloads = number(item.downloads)
    const likes = number(item.likes)
    if (
      !repo.includes('/') ||
      !Number.isSafeInteger(downloads) ||
      downloads < 0 ||
      !Number.isSafeInteger(likes) ||
      likes < 0
    )
      throw malformed()
    return {
      repo_id: repo,
      downloads,
      likes,
      task: nullableText(item.task),
      updated_at: nullableText(item.updated_at),
    }
  })
}
