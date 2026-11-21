import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { NMessageProvider } from 'naive-ui'
import { expect, it, vi } from 'vitest'
import { createWebSearchController, type WebSearchGateway } from './controller'
import { configureWebSearch, useWebSearch } from './store'
import WebSearchSettings from './WebSearchSettings.vue'

const saved = {
  id: 'web',
  revision: 2,
  provider: 'tavily' as const,
  baseUrl: 'https://saved.example',
  credentialConfigured: true,
  ready: true,
}
function fixture(get: WebSearchGateway['get']) {
  const gateway = {
    get,
    save: vi.fn().mockRejectedValue(new Error('save failed')),
    test: vi.fn(),
  }
  configureWebSearch(() => createWebSearchController(gateway))
  const pinia = createPinia()
  const wrapper = mount(
    defineComponent({ setup: () => () => h(NMessageProvider, () => h(WebSearchSettings)) }),
    { global: { plugins: [pinia] } },
  )
  return { gateway, wrapper, state: useWebSearch(pinia) }
}

it('recovers from an initial read failure without leaving settings or submitting credentials', async () => {
  let finish!: (value: typeof saved) => void
  const get = vi
    .fn()
    .mockRejectedValueOnce(new Error('read failed'))
    .mockImplementationOnce(
      () =>
        new Promise<typeof saved>((resolve) => {
          finish = resolve
        }),
    )
  const { wrapper, state, gateway } = fixture(get)
  try {
    await flushPromises()
    expect(wrapper.text()).toContain('read failed')
    const retry = wrapper.findAll('button').find((button) => button.text() === '重试读取配置')
    expect(retry).toBeDefined()
    await retry!.trigger('click')
    await state.load()
    expect(get).toHaveBeenCalledTimes(2)
    expect(state.loadPending).toBe(true)
    expect(gateway.save).not.toHaveBeenCalled()
    expect(gateway.test).not.toHaveBeenCalled()
    finish(saved)
    await flushPromises()
    expect(state.settings).toEqual(saved)
    expect(wrapper.get('[aria-label="搜索服务地址"] input').element).toHaveProperty(
      'value',
      saved.baseUrl,
    )
    expect(wrapper.text()).not.toContain('read failed')
    expect(wrapper.text()).not.toContain('重试读取配置')
    const testButton = wrapper
      .findAll('button')
      .find((button) => button.text() === '测试已保存配置')
    expect(testButton).toBeDefined()
    expect(testButton!.attributes('disabled')).toBeUndefined()
  } finally {
    wrapper.unmount()
  }
})

it('keeps retry available after another read failure, but not for a failed save', async () => {
  const get = vi
    .fn()
    .mockRejectedValueOnce(new Error('first failure'))
    .mockRejectedValueOnce(new Error('still offline'))
    .mockResolvedValue(saved)
  const { wrapper, state, gateway } = fixture(get)
  const retry = () => wrapper.findAll('button').find((button) => button.text() === '重试读取配置')
  try {
    await flushPromises()
    expect(retry()).toBeDefined()
    await retry()!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('still offline')
    expect(retry()).toBeDefined()
    await retry()!.trigger('click')
    await flushPromises()
    state.baseUrl = 'https://edited.example'
    await state.save()
    await flushPromises()
    expect(wrapper.text()).toContain('save failed')
    expect(retry()).toBeUndefined()
    expect(state.baseUrl).toBe('https://edited.example')
    expect(gateway.save).toHaveBeenCalledOnce()
    expect(get).toHaveBeenCalledTimes(3)
  } finally {
    wrapper.unmount()
  }
})
