import type { Transport } from './transport/ports'
import { record, text, list } from './decoders'
import {
  decodeProject,
  decodeCodingSettings,
  type CodingSettings,
  decodeSession,
  decodeRun,
  decodeCapability,
  decodeSnapshot,
  decodeChanges,
  decodeChange,
  type CodingSessionPatch,
  type CodingRunRequest,
} from './coding-decoders'
const root = '/internal/v1/coding'
const id = encodeURIComponent
export function codingEndpoints(transport: Pick<Transport, 'get' | 'post' | 'patch' | 'delete'>) {
  return {
    settings: async () => decodeCodingSettings(await transport.get(`${root}/settings`)),
    saveSettings: async (body: CodingSettings) =>
      decodeCodingSettings(await transport.patch(`${root}/settings`, body)),
    projects: async () => list(await transport.get(`${root}/projects`), decodeProject),
    register: async (path: string) =>
      decodeProject(await transport.post(`${root}/projects`, { path })),
    configure: async (key: string, commands: string[]) =>
      decodeProject(await transport.patch(`${root}/projects/${id(key)}`, { commands })),
    removeProject: (key: string) => transport.delete(`${root}/projects/${id(key)}`),
    sessions: async (key: string, signal?: AbortSignal, before?: string) =>
      list(
        await transport.get(
          `${root}/projects/${id(key)}/sessions${before ? `?before=${id(before)}` : ''}`,
          signal,
        ),
        decodeSession,
      ),
    create: async (key: string) =>
      decodeSession(await transport.post(`${root}/projects/${id(key)}/sessions`, {})),
    update: async (key: string, patch: CodingSessionPatch) =>
      decodeSession(await transport.patch(`${root}/sessions/${id(key)}`, patch)),
    remove: (key: string) => transport.delete(`${root}/sessions/${id(key)}`),
    snapshot: async (key: string, signal?: AbortSignal) =>
      decodeSnapshot(await transport.get(`${root}/sessions/${id(key)}/snapshot`, signal)),
    submit: async (key: string, body: CodingRunRequest) =>
      decodeRun(await transport.post(`${root}/sessions/${id(key)}/runs`, body)),
    verify: async (key: string, modelId: string) =>
      decodeRun(
        await transport.post(`${root}/sessions/${id(key)}/verify`, {
          submissionId: crypto.randomUUID(),
          text: '运行验证',
          modelId,
          mode: 'develop',
        }),
      ),
    cancelActive: () => transport.post(`${root}/cancel-active`),
    cancel: (key: string) => transport.post(`${root}/runs/${id(key)}/cancel`),
    setPermissions: async (key: string, permissionMode: 'ask' | 'full') =>
      decodeRun(await transport.patch(`${root}/runs/${id(key)}/permissions`, { permissionMode })),
    steer: (key: string, value: string) =>
      transport.post(`${root}/runs/${id(key)}/steer`, { text: value }),
    resolve: (key: string, allowed: boolean) =>
      transport.post(`${root}/approvals/${id(key)}/resolve`, { allowed }),
    changes: async (key: string, before?: string) =>
      decodeChanges(
        await transport.get(
          `${root}/sessions/${id(key)}/changes?diff=true${before ? `&before=${id(before)}` : ''}`,
        ),
      ),
    files: async (key: string) =>
      list(record(await transport.get(`${root}/sessions/${id(key)}/files`)).files, text),
    read: async (key: string, path: string) =>
      text(
        record(await transport.get(`${root}/sessions/${id(key)}/file?path=${id(path)}`)).content,
      ),
    change: async (key: string) => decodeChange(await transport.get(`${root}/changes/${id(key)}`)),
    restore: (key: string) => transport.post(`${root}/changes/${id(key)}/restore`),
    capabilities: async () => list(await transport.get(`${root}/capabilities`), decodeCapability),
    verifyModel: async (key: string) =>
      decodeCapability(await transport.post(`${root}/capabilities/${id(key)}/verify`)),
  }
}
