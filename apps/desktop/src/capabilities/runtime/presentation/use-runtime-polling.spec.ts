import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useRuntimePolling } from './use-runtime-polling'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
it('pauses hidden windows, immediately refreshes on return, and releases its interval', async () => {
  vi.useFakeTimers()
  let visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility as DocumentVisibilityState,
  )
  const poll = vi.fn(async () => {})
  const wrapper = mount(
    defineComponent({
      setup() {
        useRuntimePolling(poll)
        return () => h('div')
      },
    }),
  )
  await vi.advanceTimersByTimeAsync(2500)
  expect(poll).toHaveBeenCalledTimes(2)
  visibility = 'hidden'
  document.dispatchEvent(new Event('visibilitychange'))
  await nextTick()
  await vi.advanceTimersByTimeAsync(10000)
  expect(poll).toHaveBeenCalledTimes(2)
  visibility = 'visible'
  document.dispatchEvent(new Event('visibilitychange'))
  await nextTick()
  expect(poll).toHaveBeenCalledTimes(3)
  wrapper.unmount()
  await vi.advanceTimersByTimeAsync(10000)
  expect(poll).toHaveBeenCalledTimes(3)
})
