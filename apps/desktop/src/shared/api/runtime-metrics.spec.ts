import { createEndpoints, RuntimeClient } from '@mlx-studio/api-client'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())
it('decodes old metrics without inventing system memory, and rejects invalid percentages', async () => {
  const payload = {
    uptime_seconds: 1,
    process_max_rss_bytes: 10,
    disk_free_bytes: 20,
    worker_restarts: 0,
    active_jobs: 0,
  }
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload)))
  vi.stubGlobal('fetch', fetchMock)
  const api = createEndpoints(
    new RuntimeClient({ baseUrl: 'http://127.0.0.1:1234', token: 'test', protocolVersion: 1 }),
  )
  expect((await api.runtime.metrics()).system_memory_used_bytes).toBeNull()
  fetchMock.mockImplementationOnce(
    async () => new Response(JSON.stringify({ ...payload, system_memory_used_percent: 110 })),
  )
  await expect(api.runtime.metrics()).rejects.toMatchObject({ code: 'RESPONSE_INVALID' })
})
