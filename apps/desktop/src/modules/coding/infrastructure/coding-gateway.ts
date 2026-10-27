import { codingEndpoints, type RuntimeClient } from '@mlx-studio/api-client'
import type { CodingGateway } from '../application/ports'
export function createCodingGateway(client: () => Promise<RuntimeClient>): CodingGateway {
  const transport = {
    get: async (path: string, signal?: AbortSignal) => (await client()).get(path, signal),
    post: async (path: string, body?: unknown) => (await client()).post(path, body),
    patch: async (path: string, body: unknown) => (await client()).patch(path, body),
    delete: async (path: string) => (await client()).delete(path),
  }
  return codingEndpoints(transport)
}
