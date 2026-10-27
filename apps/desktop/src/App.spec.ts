import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  newConversation: vi.fn(async () => {}),
  conversations: [] as { id: string; title: string }[],
}))
vi.mock('./modules/chat/stores/chat.store', async () => {
  const { defineStore } = await import('pinia')
  return {
    useChatStore: defineStore('sidebar-test-chat', {
      state: () => ({ conversations: mocks.conversations, busy: false, pending: false }),
      actions: { loadWorkspace: mocks.loadWorkspace, newConversation: mocks.newConversation },
    }),
  }
})
async function render(path: string, attach = false) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/chat', '/coding', '/models', '/image-studio', '/audio-studio', '/settings'].map(
      (path) => ({
        path,
        meta: { workspace: path === '/chat' ? 'chat' : path === '/coding' ? 'coding' : undefined },
        component: { template: '<div class="test-page">页面内容</div>' },
      }),
    ),
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App, {
    attachTo: attach ? document.body : undefined,
    global: {
      plugins: [createPinia(), router],
      stubs: { RuntimeStatusBanner: true, TaskCenter: true },
    },
  })
  await flushPromises()
  return { wrapper, router }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.conversations.splice(0)
})
describe('workspace sidebar visibility', () => {
  it('focuses chat search on opening, restores focus on Escape and clears it for a new conversation', async () => {
    mocks.conversations.push({ id: 'a', title: '图书馆管理' }, { id: 'b', title: '数据同步' })
    const { wrapper } = await render('/chat', true)
    const toggle = wrapper.get('[aria-label="搜索历史对话"]')
    await toggle.trigger('click')
    const input = wrapper.get('.sidebar-search input')
    expect(document.activeElement).toBe(input.element)
    await input.setValue('图书')
    expect(wrapper.findAll('.session-title').map((item) => item.text())).toEqual(['图书馆管理'])
    await input.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.sidebar-search').exists()).toBe(false)
    expect(document.activeElement).toBe(toggle.element)
    await toggle.trigger('click')
    const reopened = wrapper.get<HTMLInputElement>('.sidebar-search input')
    expect(reopened.element.value).toBe('')
    expect(wrapper.findAll('.session-title')).toHaveLength(2)
    await reopened.setValue('同步')
    await wrapper.get('.new-conversation').trigger('click')
    await flushPromises()
    expect(mocks.newConversation).toHaveBeenCalledOnce()
    expect(wrapper.find('.sidebar-search').exists()).toBe(false)
    expect(wrapper.findAll('.session-title')).toHaveLength(2)
    wrapper.unmount()
  })
  it.each(['/chat', '/coding', '/models', '/image-studio', '/audio-studio', '/settings'])(
    'shows conversation navigation only on chat when opening %s',
    async (path) => {
      const { wrapper } = await render(path)
      const chat = path === '/chat'
      expect(wrapper.find('.sidebar-content').exists()).toBe(chat)
      expect(wrapper.get('.app-shell').classes().includes('has-chat-sidebar')).toBe(chat)
      expect(wrapper.find('.topbar').exists()).toBe(!chat && path !== '/coding')
      expect(wrapper.get('[aria-label="主导航"]').findAll('.rail-link')).toHaveLength(6)
      expect(mocks.loadWorkspace).toHaveBeenCalledTimes(chat ? 1 : 0)
      expect(wrapper.get('.test-page').text()).toBe('页面内容')
      wrapper.unmount()
    },
  )
  it('hides the conversation panel across other pages and restores it on return', async () => {
    const { wrapper, router } = await render('/chat')
    for (const path of ['/models', '/image-studio', '/settings']) {
      await router.push(path)
      await flushPromises()
      expect(wrapper.find('[aria-label="最近对话"]').exists()).toBe(false)
      expect(wrapper.find('[aria-label="搜索历史对话"]').exists()).toBe(false)
      expect(wrapper.get('.app-shell').classes()).not.toContain('has-chat-sidebar')
    }
    await router.push('/chat')
    await flushPromises()
    expect(wrapper.find('[aria-label="最近对话"]').exists()).toBe(true)
    expect(wrapper.get('.app-shell').classes()).toContain('has-chat-sidebar')
    expect(mocks.loadWorkspace).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})
