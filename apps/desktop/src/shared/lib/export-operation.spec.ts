import { describe, expect, it, vi } from 'vitest'
import { createExportOperation } from './export-operation'
import type { FileExportResult } from './file-export'
function deferred<T>() {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>((done) => {
      resolve = done
    }),
    resolve,
  }
}
describe('export ownership', () => {
  it('does not open a late dialog and an old finally cannot clear a new operation', async () => {
    const operation = createExportOperation(),
      first = deferred<Blob>(),
      second = deferred<Blob>(),
      write = vi.fn(async (): Promise<FileExportResult> => ({ kind: 'saved', filename: 'a' }))
    const old = operation.run({ id: 'a', read: () => first.promise, write })
    expect(await operation.run({ id: 'a', read: async () => new Blob(), write })).toMatchObject({
      kind: 'blocked',
    })
    operation.invalidate()
    const current = operation.run({ id: 'a', read: () => second.promise, write })
    first.resolve(new Blob())
    expect(await old).toEqual({ kind: 'obsolete' })
    expect(operation.pending.value.a).toBeDefined()
    expect(write).not.toHaveBeenCalled()
    second.resolve(new Blob())
    expect(await current).toMatchObject({ kind: 'saved' })
    expect(operation.pending.value.a).toBeUndefined()
  })
  it('retains the actual write result after leaving while the native dialog is open', async () => {
    const operation = createExportOperation(),
      saved = deferred<FileExportResult>(),
      write = vi.fn(() => saved.promise)
    const task = operation.run({ id: 'a', read: async () => new Blob(), write })
    await Promise.resolve()
    expect(write).toHaveBeenCalledOnce()
    operation.invalidate()
    saved.resolve({ kind: 'saved', filename: 'a' })
    expect(await task).toEqual({ kind: 'saved', filename: 'a' })
  })
})
