import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import { NMessageProvider } from 'naive-ui'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuntimeStatusBanner from './RuntimeStatusBanner.vue'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), poll: vi.fn(), restart: vi.fn() }))
const status = ref<'starting' | 'ready' | 'failed'>('ready')
const runtime = reactive({
  error: null as string | null,
  systemMemory: '24.3 / 64.0 GB',
  refresh: mocks.refresh,
  poll: mocks.poll,
})
vi.mock('../store', () => ({ useRuntimeStore: () => runtime }))
vi.mock('./use-runtime-polling', () => ({ useRuntimePolling: vi.fn() }))
vi.mock('../../../platform/runtime-bridge', () => ({
  get runtimeConnectionStatus() {
    return status
  },
  runtimeConnectionError: null,
  canRestartRuntime: () => true,
  restartRuntimeProcess: mocks.restart,
}))
function render() {
  return mount(
    defineComponent({
      setup: () => () => h(NMessageProvider, () => h(RuntimeStatusBanner)),
    }),
  )
}
beforeEach(() => {
  status.value = 'ready'
  runtime.error = null
  vi.clearAllMocks()
})
describe('header Runtime summary', () => {
  it('shows a noninteractive running status followed by live memory', async () => {
    const wrapper = render()
    expect(wrapper.get('[role="status"]').text()).toBe('Runtime 运行中')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.get('.runtime-summary').element.lastElementChild?.textContent).toContain(
      '内存 24.3 / 64.0 GB',
    )
    runtime.systemMemory = '25.0 / 64.0 GB'
    await nextTick()
    expect(wrapper.get('.runtime-memory').text()).toContain('25.0 / 64.0 GB')
    wrapper.unmount()
  })
  it('keeps starting status noninteractive', () => {
    status.value = 'starting'
    const wrapper = render()
    expect(wrapper.get('[role="status"]').text()).toBe('Runtime 启动中')
    expect(wrapper.find('button').exists()).toBe(false)
    wrapper.unmount()
  })
  it('retains recovery when the Runtime disconnects', async () => {
    status.value = 'failed'
    const wrapper = render()
    await wrapper.get('button').trigger('click')
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce())
    expect(mocks.restart).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
})
