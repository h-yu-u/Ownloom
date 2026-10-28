import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { createExportOperation } from '../shared/lib/export-operation'
import { exportBlob } from './files'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
beforeEach(() => vi.mocked(isTauri).mockReturnValue(true))
afterEach(() => vi.resetAllMocks())
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
function exportFixture(bytes: Promise<ArrayBuffer>) {
  const operation = createExportOperation()
  const blob = new Blob(['content'])
  const read = vi.fn(() => bytes)
  Object.defineProperty(blob, 'arrayBuffer', { value: read })
  const result = operation.run({
    id: 'a',
    read: async () => blob,
    write: (content, signal) => exportBlob(content, 'a.txt', signal),
  })
  return { operation, read, result }
}

describe('export preparation ownership at the native boundary', () => {
  it('does not open a native dialog when ownership expires during the byte read', async () => {
    const bytes = deferred<ArrayBuffer>()
    const { operation, read, result } = exportFixture(bytes.promise)
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    operation.invalidate()
    bytes.resolve(new ArrayBuffer(7))
    expect(await result).toEqual({ kind: 'obsolete' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not surface a late byte-read error after the owner has left', async () => {
    const bytes = deferred<ArrayBuffer>()
    const { operation, read, result } = exportFixture(bytes.promise)
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    operation.invalidate()
    bytes.reject(new Error('read failed'))
    expect(await result).toEqual({ kind: 'obsolete' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'keeps the actual native result %s once the dialog is open',
    async (saved) => {
      const native = deferred<boolean>()
      vi.mocked(invoke).mockReturnValueOnce(native.promise)
      const { operation, result } = exportFixture(Promise.resolve(new ArrayBuffer(7)))
      await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce())
      operation.invalidate()
      native.resolve(saved)
      expect(await result).toEqual(
        saved ? { kind: 'saved', filename: 'a.txt' } : { kind: 'cancelled' },
      )
    },
  )
})
