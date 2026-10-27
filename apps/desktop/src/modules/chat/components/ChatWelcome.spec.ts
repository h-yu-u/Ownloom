import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import ChatWelcome from './ChatWelcome.vue'

async function render() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/chat', '/coding', '/audio-studio'].map((path) => ({
      path,
      component: { render: () => null },
    })),
  })
  await router.push('/chat')
  const wrapper = mount(ChatWelcome, { global: { plugins: [router] } })
  return { wrapper, router }
}

describe('ChatWelcome', () => {
  it.each([
    ['/coding', '帮我写代码'],
    ['/audio-studio', '创作一段语音'],
  ])('opens %s directly instead of putting an example in the chat draft', async (path, label) => {
    const { wrapper, router } = await render()
    const link = wrapper.get(`a[href="${path}"]`)
    expect(link.text()).toBe(label)
    await link.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(path)
    expect(wrapper.emitted('prompt')).toBeUndefined()
    expect(wrapper.emitted('image')).toBeUndefined()
    wrapper.unmount()
  })

  it('sends image examples to the image workflow', async () => {
    const { wrapper } = await render()
    await wrapper.get('.example-card:nth-child(1)').trigger('click')
    expect(wrapper.emitted('image')?.[0]?.[0]).toContain('山湖风景图')
    expect(wrapper.emitted('prompt')).toBeUndefined()
    wrapper.unmount()
  })
})
