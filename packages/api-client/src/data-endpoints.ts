import type { components } from './generated-schema'
import type { Transport } from './transport/ports'
import { record, list, text, number, nullableText } from './decoders'
export type TaskSummary = components['schemas']['TaskSummary']
export type StorageView = components['schemas']['StorageView']
export type DownloadView = components['schemas']['DownloadView']
function task(raw: unknown): TaskSummary {
  const v = record(raw)
  return {
    owner: text(v.owner),
    id: text(v.id),
    state: text(v.state),
    phase: text(v.phase),
    sessionId: nullableText(v.sessionId),
    needsApproval: v.needsApproval === true,
    errorCode: nullableText(v.errorCode),
    target: text(v.target),
    title: nullableText(v.title),
    kind: nullableText(v.kind),
    groupId: nullableText(v.groupId),
    parentId: nullableText(v.parentId),
    createdAt: v.createdAt == null ? null : number(v.createdAt),
  }
}
function download(raw: unknown): DownloadView {
  const v = record(raw)
  return {
    id: text(v.id),
    repoId: text(v.repoId),
    revision: nullableText(v.revision),
    state: text(v.state),
    pausedByUser: v.pausedByUser === true,
    errorCode: nullableText(v.errorCode),
    transferredBytes: number(v.transferredBytes),
    modelId: nullableText(v.modelId),
  }
}
export function dataEndpoints(transport: Pick<Transport, 'get' | 'post' | 'delete'>) {
  const root = '/internal/v1'
  return {
    tasks: async (signal?: AbortSignal) => list(await transport.get(`${root}/tasks`, signal), task),
    downloads: async () => list(await transport.get(`${root}/downloads`), download),
    downloadAction: (id: string, action: 'pause' | 'resume' | 'cancel') =>
      transport.post(`${root}/downloads/${encodeURIComponent(id)}/${action}`),
    storage: async (): Promise<StorageView> => {
      const v = record(await transport.get(`${root}/storage`))
      const categories = Object.fromEntries(
        Object.entries(record(v.categories)).map(([key, value]) => [key, number(value)]),
      )
      return {
        bytes: number(v.bytes),
        categories,
        automaticCleanup: v.automaticCleanup === true,
        trash: list(v.trash, (raw) => {
          const item = record(raw)
          return { id: text(item.id), kind: text(item.kind) }
        }),
        candidates: list(v.candidates, (raw) => {
          const item = record(raw)
          return { id: text(item.id), name: text(item.name), bytes: number(item.bytes) }
        }),
      }
    },
    activateProfile: (id: string) =>
      transport.post(`${root}/storage/restore/${encodeURIComponent(id)}/activate`),
    rollbackProfile: () => transport.post(`${root}/storage/restore/rollback`),
    cleanup: () => transport.post(`${root}/storage/cleanup`),
    restore: (id: string) =>
      transport.post(`${root}/storage/trash/${encodeURIComponent(id)}/restore`),
    recycleImage: (id: string) =>
      transport.delete(`${root}/image-artifacts/${encodeURIComponent(id)}`),
  }
}
