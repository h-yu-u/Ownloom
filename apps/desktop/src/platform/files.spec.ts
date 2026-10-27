import { afterEach, describe, expect, it, vi } from 'vitest'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { exportBlob } from './files'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('file export platform boundary', () => {
  it('uses binary IPC and a suggested name without accepting a destination path', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    const raw = new Uint8Array([1, 2, 3]).buffer
    class TestBlob extends Blob {
      override arrayBuffer() {
        return Promise.resolve(raw)
      }
    }
    await exportBlob(new TestBlob(['abc']), 'sample.wav')
    expect(invoke).toHaveBeenCalledWith('export_blob', raw, {
      headers: { 'x-mlx-export-name': 'sample.wav' },
    })
  })
  it('returns explicit native write failure', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    vi.mocked(invoke).mockRejectedValueOnce(new Error('EXPORT_WRITE_FAILED'))
    class TestBlob extends Blob {
      override arrayBuffer() {
        return Promise.resolve(new ArrayBuffer(3))
      }
    }
    await expect(exportBlob(new TestBlob(['abc']), 'sample.wav')).resolves.toMatchObject({
      kind: 'failed',
      code: 'write-failed',
    })
  })
  it('keeps ordinary downloads in browser mode and releases the object URL', async () => {
    vi.useFakeTimers()
    vi.mocked(isTauri).mockReturnValue(false)
    const create = vi.fn(() => 'blob:test'),
      revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    expect(await exportBlob(new Blob(['abc']), 'sample.wav')).toEqual({
      kind: 'download-started',
      filename: 'sample.wav',
    })
    expect(revoke).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(click).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:test')
  })
})

it.each([true, false])('preserves native result %s', async (saved) => {
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(invoke).mockResolvedValueOnce(saved)
  const blob = new Blob(['abc'])
  Object.defineProperty(blob, 'arrayBuffer', { value: async () => new ArrayBuffer(3) })
  expect(await exportBlob(blob, 'a.txt')).toEqual(
    saved ? { kind: 'saved', filename: 'a.txt' } : { kind: 'cancelled' },
  )
})
it('accepts exactly 64 MiB and rejects larger files before reading', async () => {
  vi.mocked(isTauri).mockReturnValue(true)
  vi.mocked(invoke).mockResolvedValue(true)
  const read = vi.fn(async () => new ArrayBuffer(1)),
    blob = new Blob()
  Object.defineProperty(blob, 'size', { value: 64 * 1024 * 1024, configurable: true })
  Object.defineProperty(blob, 'arrayBuffer', { value: read })
  expect((await exportBlob(blob, 'a.bin')).kind).toBe('saved')
  Object.defineProperty(blob, 'size', { value: 64 * 1024 * 1024 + 1 })
  expect(await exportBlob(blob, 'a.bin')).toMatchObject({ kind: 'failed', code: 'too-large' })
  expect(read).toHaveBeenCalledOnce()
})
