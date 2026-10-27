import { createArtifactHistory } from '../../../capabilities/media'
import type { FileExportResult } from '../../../shared/lib/file-export'
import type { AudioGateway } from '../application/ports'
export function createAudioHistoryController(deps: {
  gateway: AudioGateway
  exportAudio(blob: Blob, id: string): Promise<FileExportResult>
  onError(cause: unknown): void
}) {
  const history = createArtifactHistory({
    ...deps.gateway,
    content: deps.gateway.audio,
    export: deps.exportAudio,
  })
  const removing = new Set<string>()
  let generation = 0
  async function remove(id: string): Promise<boolean> {
    if (removing.has(id)) return false
    removing.add(id)
    const owner = generation
    try {
      await deps.gateway.deleteArtifact(id)
      history.forget(id)
      if (owner === generation) await history.loadHistory(true)
      return true
    } catch (cause) {
      if (owner === generation) deps.onError(cause)
      return false
    } finally {
      removing.delete(id)
    }
  }
  return {
    ...history,
    remove,
    activate: () => {
      generation++
      history.activate()
    },
    dispose: () => {
      generation++
      history.dispose()
    },
  }
}
