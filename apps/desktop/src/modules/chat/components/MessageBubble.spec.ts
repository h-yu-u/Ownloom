import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import MessageBubble from './MessageBubble.vue'
import { renderMarkdown } from '../../../shared/lib/render-markdown'
import { copyText } from '../../../platform/clipboard'

vi.mock('../../../platform/clipboard', () => ({ copyText: vi.fn() }))

vi.mock('../../../shared/lib/render-markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/lib/render-markdown')>()
  return { ...actual, renderMarkdown: vi.fn(actual.renderMarkdown) }
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.mocked(copyText).mockReset()
})
it('bounds Markdown work during streaming and immediately renders the exact final text', async () => {
  vi.useFakeTimers()
  const message = {
    id: 'job',
    role: 'assistant' as const,
    content: '',
    state: 'streaming' as const,
  }
  const wrapper = mount(MessageBubble, { props: { message } })
  for (let index = 1; index <= 100; index++) {
    await wrapper.setProps({ message: { ...message, content: `**Answer ${index}**` } })
  }
  expect(vi.mocked(renderMarkdown).mock.calls.length).toBeLessThan(5)
  await wrapper.setProps({ message: { ...message, content: '**Final**', state: 'complete' } })
  expect(wrapper.get('.markdown-body strong').text()).toBe('Final')
  wrapper.unmount()
  vi.runAllTimers()
})
it('explains truncation and offers continuing only when allowed', async () => {
  const wrapper = mount(MessageBubble, {
    props: {
      message: {
        id: 'job',
        role: 'assistant',
        content: 'partial',
        state: 'complete',
        finishReason: 'length',
      },
      canContinue: true,
    },
  })
  expect(wrapper.find('[aria-label="继续回答"]').exists()).toBe(true)
  await wrapper.get('[aria-label="继续回答"]').trigger('click')
  expect(wrapper.emitted('continue')).toHaveLength(1)
  await wrapper.setProps({ canContinue: false })
  expect(wrapper.findAll('button').some((button) => button.text().includes('继续'))).toBe(false)
  wrapper.unmount()
})
it('keeps unsafe HTML escaped after throttling', () => {
  const wrapper = mount(MessageBubble, {
    props: { message: { id: 'job', role: 'assistant', content: '<script>alert(1)</script>' } },
  })
  expect(wrapper.find('script').exists()).toBe(false)
  expect(wrapper.text()).toContain('<script>')
  wrapper.unmount()
})

it('copies only the selected code block, with original whitespace and decoded characters', async () => {
  const wrapper = mount(MessageBubble, {
    props: {
      message: {
        id: 'job',
        role: 'assistant',
        content: '正文\n\n```ts\nconst value = "<&>";\n  // 中文\n```\n\n```sh\necho second\n```',
      },
    },
  })
  const buttons = wrapper.findAll('button.code-copy')
  expect(buttons).toHaveLength(2)
  await buttons[0]!.trigger('click')
  await flushPromises()
  expect(copyText).toHaveBeenLastCalledWith('const value = "<&>";\n  // 中文\n')
  expect(buttons[0]!.text()).toBe('已复制')
  expect(buttons[1]!.text()).toBe('复制')
  await buttons[1]!.trigger('click')
  expect(copyText).toHaveBeenLastCalledWith('echo second\n')
  wrapper.unmount()
})

it('clears obsolete feedback when code changes and copies the latest visible code', async () => {
  vi.useFakeTimers()
  const message = {
    id: 'job',
    role: 'assistant' as const,
    state: 'streaming' as const,
    content: '```ts\nconst x = 1;\n```',
  }
  const wrapper = mount(MessageBubble, { props: { message } })
  await wrapper.get('button.code-copy').trigger('click')
  await Promise.resolve()
  await wrapper.setProps({ message: { ...message, content: '```ts\nconst x = 2;\n```' } })
  await vi.advanceTimersByTimeAsync(100)
  expect(wrapper.get('button.code-copy').text()).toBe('复制')
  await wrapper.get('button.code-copy').trigger('click')
  expect(copyText).toHaveBeenLastCalledWith('const x = 2;\n')
  await vi.advanceTimersByTimeAsync(1800)
  expect(wrapper.get('button.code-copy').text()).toBe('复制')
  wrapper.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('shows failures and permits retrying without reporting a false success', async () => {
  vi.mocked(copyText).mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce()
  const wrapper = mount(MessageBubble, {
    props: { message: { id: 'job', role: 'assistant', content: '```\nhello\n```' } },
  })
  await wrapper.get('button.code-copy').trigger('click')
  await flushPromises()
  expect(wrapper.get('button.code-copy').text()).toBe('复制失败，重试')
  await wrapper.get('button.code-copy').trigger('click')
  await flushPromises()
  expect(wrapper.get('button.code-copy').text()).toBe('已复制')
  wrapper.unmount()
})

it('keeps unresolved citation feedback when only some sources exist', () => {
  const wrapper = mount(MessageBubble, {
    props: {
      message: {
        id: 'partial',
        role: 'assistant',
        state: 'complete',
        content: '[[cite:known]] and [[cite:missing]]',
        sources: [
          {
            id: 'known',
            title: 'Known',
            url: 'https://example.com',
            kind: 'web',
            representation: 'snippet_only',
            contentHash: '',
            retrievedAt: '',
          },
        ],
      },
    },
  })
  expect(wrapper.text()).toContain('部分引用无法定位')
  wrapper.unmount()
})

it('keeps only copy and regenerate in the completed answer toolbar', async () => {
  const wrapper = mount(MessageBubble, {
    props: {
      message: {
        id: 'answer',
        role: 'assistant',
        content: '**完整回答**',
        state: 'complete',
        parameters: { contextJobId: 'context' },
        sources: [
          {
            id: 'w1',
            kind: 'web',
            title: '来源',
            url: 'https://example.com',
            retrievedAt: '',
            representation: 'snippet_only',
            contentHash: '',
          },
        ],
      },
      canContinue: true,
    },
  })
  const toolbar = wrapper.get('[aria-label="回答操作"]')
  expect(toolbar.findAll('button').map((button) => button.attributes('aria-label'))).toEqual([
    '复制回答',
    '重新生成',
  ])
  await toolbar.get('[aria-label="复制回答"]').trigger('click')
  await flushPromises()
  expect(copyText).toHaveBeenLastCalledWith('**完整回答**')
  expect(toolbar.find('[aria-label="已复制"]').exists()).toBe(true)
  await toolbar.get('[aria-label="重新生成"]').trigger('click')
  expect(wrapper.emitted('regenerate')).toHaveLength(1)
  await wrapper.setProps({ busy: true })
  expect(toolbar.get('[aria-label="重新生成"]').attributes('disabled')).toBeDefined()
  wrapper.unmount()
})

it('keeps streaming and user messages free of answer actions', () => {
  for (const message of [
    { id: 'user', role: 'user' as const, content: 'hello' },
    { id: 'stream', role: 'assistant' as const, content: 'partial', state: 'streaming' as const },
  ]) {
    const wrapper = mount(MessageBubble, { props: { message } })
    expect(wrapper.find('[aria-label="回答操作"]').exists()).toBe(false)
    expect(wrapper.find('.message-role').exists()).toBe(message.role === 'assistant')
    expect(wrapper.attributes('aria-label')).toBe(message.role === 'user' ? '用户消息' : '助手消息')
    wrapper.unmount()
  }
})

it('distinguishes publication and retrieval dates for web sources', () => {
  const wrapper = mount(MessageBubble, {
    props: {
      message: {
        id: 'web',
        role: 'assistant',
        content: 'answer',
        sources: [
          {
            id: 'w1',
            kind: 'web',
            title: 'Old article',
            url: 'https://example.com',
            publishedAt: '2025-07-27',
            retrievedAt: '2026-10-23T15:16:42Z',
            representation: 'snippet_only',
            contentHash: '',
          },
        ],
      },
    },
  })
  expect(wrapper.text()).toContain('发布/更新 2025/07/27')
  expect(wrapper.text()).toContain('检索 2026/10/23')
  expect(wrapper.text()).not.toContain('T15:16:42Z')
  wrapper.unmount()
})

it('locates inline citations without changing the hash route or opening another conversation', async () => {
  const wrapper = mount(MessageBubble, {
    attachTo: document.body,
    props: {
      message: {
        id: 'answer-with-source',
        role: 'assistant',
        content: '证据 [[cite:w1]]',
        sources: [
          {
            id: 'w1',
            kind: 'web',
            title: 'Source',
            url: 'https://example.com/article',
            retrievedAt: '2026-10-23',
            representation: 'snippet_only',
            contentHash: '',
          },
        ],
      },
    },
  })
  const target = wrapper.get('[data-source-id="w1"]').element as HTMLElement
  const scroll = vi.fn()
  target.scrollIntoView = scroll
  const hash = window.location.hash
  const click = new MouseEvent('click', { bubbles: true, cancelable: true })
  wrapper.get('a.citation').element.dispatchEvent(click)
  await flushPromises()
  expect(click.defaultPrevented).toBe(true)
  expect(window.location.hash).toBe(hash)
  expect(scroll).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(target)
  wrapper.unmount()
})
