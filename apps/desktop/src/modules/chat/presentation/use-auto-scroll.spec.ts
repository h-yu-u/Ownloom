import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useAutoScroll } from './use-auto-scroll'

afterEach(() => vi.useRealTimers())
it('follows rendered text once per frame, respects reading older messages, and cleans up', async () => {
  vi.useFakeTimers()
  const content = ref('start')
  const wrapper = mount(
    defineComponent({
      setup() {
        const target = ref<HTMLElement | null>(null)
        useAutoScroll(target)
        return () => h('div', { ref: target }, content.value)
      },
    }),
  )
  const node = wrapper.element as HTMLElement
  let height = 1000
  let top = 800
  const writes = vi.fn((value: number) => {
    top = Math.max(0, Math.min(value, height - 200))
  })
  Object.defineProperties(node, {
    scrollHeight: { get: () => height },
    clientHeight: { get: () => 200 },
    scrollTop: { get: () => top, set: writes },
  })
  await nextTick()
  height = 1200
  content.value += ' next'
  await nextTick()
  await vi.advanceTimersByTimeAsync(40)
  expect(top).toBe(1000)
  expect(writes).toHaveBeenCalledTimes(1)
  top = 100
  await wrapper.trigger('scroll')
  height = 1400
  content.value += ' more'
  await nextTick()
  await vi.advanceTimersByTimeAsync(40)
  expect(top).toBe(100)
  top = 1200
  await wrapper.trigger('scroll')
  height = 1600
  content.value += ' resumed'
  await nextTick()
  await vi.advanceTimersByTimeAsync(40)
  expect(top).toBe(1400)
  wrapper.unmount()
  expect(vi.getTimerCount()).toBe(0)
})
