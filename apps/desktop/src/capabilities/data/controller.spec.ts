import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDataController } from './controller'

const preview = (id: string) => ({ id, bytes: 100, files: 2, warnings: [] })
const archive = () => new File(['archive'], 'backup.zip')
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
const controllers: ReturnType<typeof createDataController>[] = []
afterEach(() => controllers.splice(0).forEach((controller) => controller.dispose()))
function fixture() {
  const gateway = {
    storage: vi.fn(async () => ({
      bytes: 0,
      categories: {},
      automaticCleanup: false,
      trash: [],
      candidates: [],
    })),
    cleanup: vi.fn(),
    restore: vi.fn(),
    backup: vi.fn(),
    rollback: vi.fn(),
    restart: vi.fn(),
    inspect: vi.fn(async () => preview('first')),
    discardPreview: vi.fn(async () => ({ discarded: true })),
    activate: vi.fn(async (): Promise<unknown> => ({})),
  }
  const controller = createDataController(gateway)
  controllers.push(controller)
  return { controller, gateway }
}

describe('restore preview ownership', () => {
  it('discards a preview when the user cancels it', async () => {
    const { controller, gateway } = fixture()
    await controller.inspect(archive())
    await controller.cancelPreview()
    expect(gateway.discardPreview).toHaveBeenCalledExactlyOnceWith('first')
    expect(controller.preview.value).toBeNull()
    expect(gateway.activate).not.toHaveBeenCalled()
  })

  it('finishes discarding the old preview before uploading its replacement', async () => {
    const { controller, gateway } = fixture()
    await controller.inspect(archive())
    const removing = deferred<{ discarded: boolean }>()
    gateway.discardPreview.mockReturnValueOnce(removing.promise)
    gateway.inspect.mockResolvedValueOnce(preview('replacement'))
    const replacing = controller.inspect(archive())
    expect(gateway.discardPreview).toHaveBeenCalledWith('first')
    expect(gateway.inspect).toHaveBeenCalledOnce()
    expect(controller.preview.value).toBeNull()
    removing.resolve({ discarded: true })
    await replacing
    expect(gateway.inspect).toHaveBeenCalledTimes(2)
    expect(controller.preview.value?.id).toBe('replacement')
  })

  it('keeps a failed discard available for retry without uploading another archive', async () => {
    const { controller, gateway } = fixture()
    await controller.inspect(archive())
    gateway.discardPreview.mockRejectedValueOnce(new Error('cleanup unavailable'))
    await controller.inspect(archive())
    expect(controller.preview.value?.id).toBe('first')
    expect(controller.error.value).toBe('cleanup unavailable')
    expect(gateway.inspect).toHaveBeenCalledOnce()
    await controller.cancelPreview()
    expect(controller.preview.value).toBeNull()
  })

  it('releases the current preview on disposal', async () => {
    const { controller, gateway } = fixture()
    await controller.inspect(archive())
    controller.dispose()
    expect(gateway.discardPreview).toHaveBeenCalledExactlyOnceWith('first')
    expect(controller.preview.value).toBeNull()
  })

  it('discards a preview that is returned after the page has left', async () => {
    const { controller, gateway } = fixture()
    const inspecting = deferred<ReturnType<typeof preview>>()
    gateway.inspect.mockReturnValueOnce(inspecting.promise)
    const loading = controller.inspect(archive())
    await vi.waitFor(() => expect(gateway.inspect).toHaveBeenCalledOnce())
    controller.dispose()
    inspecting.resolve(preview('late'))
    await loading
    expect(gateway.discardPreview).toHaveBeenCalledExactlyOnceWith('late')
    expect(controller.preview.value).toBeNull()
    expect(gateway.storage).not.toHaveBeenCalled()
  })

  it('does not begin a replacement upload after leaving during cleanup', async () => {
    const { controller, gateway } = fixture()
    await controller.inspect(archive())
    const removing = deferred<{ discarded: boolean }>()
    gateway.discardPreview.mockReturnValueOnce(removing.promise)
    const replacing = controller.inspect(archive())
    controller.dispose()
    removing.resolve({ discarded: true })
    await replacing
    expect(gateway.inspect).toHaveBeenCalledOnce()
    expect(gateway.discardPreview).toHaveBeenCalledOnce()
  })

  it.each([true, false])(
    'does not discard an activation already handed to the server (success: %s)',
    async (succeeded) => {
      const { controller, gateway } = fixture()
      await controller.inspect(archive())
      const activation = deferred<unknown>()
      gateway.activate.mockReturnValueOnce(activation.promise)
      const activating = controller.activate()
      expect(gateway.activate).toHaveBeenCalledExactlyOnceWith('first')
      controller.dispose()
      expect(gateway.discardPreview).not.toHaveBeenCalled()
      if (succeeded) activation.resolve({})
      else activation.reject(new Error('response lost'))
      await activating
      expect(gateway.discardPreview).not.toHaveBeenCalled()
      expect(controller.preview.value).toBeNull()
      expect(controller.restartRequired.value).toBe(succeeded)
    },
  )

  it('retains the retry target after an uncertain activation response without treating it as a disposable upload', async () => {
    const { controller, gateway } = fixture()
    await controller.inspect(archive())
    gateway.activate.mockRejectedValueOnce(new Error('response lost'))
    await controller.activate()
    expect(controller.preview.value?.id).toBe('first')
    await controller.cancelPreview()
    expect(controller.preview.value).toBeNull()
    expect(gateway.discardPreview).not.toHaveBeenCalled()
  })

  it('does not upload or activate after its page is disposed', async () => {
    const { controller, gateway } = fixture()
    controller.dispose()
    await controller.inspect(archive())
    await controller.activate()
    expect(gateway.inspect).not.toHaveBeenCalled()
    expect(gateway.activate).not.toHaveBeenCalled()
  })
})
