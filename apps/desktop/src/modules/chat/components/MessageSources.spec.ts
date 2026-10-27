import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { openWebUrl } from '../../../platform/external-links'
import type { MessageSource } from '../domain/message-source'
import MessageSources from './MessageSources.vue'
import { renderMarkdown } from '../../../shared/lib/render-markdown'

it('recognizes only source-map citations outside code and preserves raw HTML safety', () => {
  const html = renderMarkdown(
    'Source [[cite:w1]] unknown [[cite:foreign]]\n\n`[[cite:w1]]`\n\n```\n[[cite:w1]]\n```\n<script>bad</script>',
    { w1: '#source-1-w1' },
  )
  const root = document.createElement('div')
  root.innerHTML = html
  expect(root.querySelectorAll('a.citation')).toHaveLength(1)
  expect(root.querySelector('a.citation')?.getAttribute('href')).toBe('#source-1-w1')
  expect(root.querySelector('script')).toBeNull()
  expect(root.querySelectorAll('code')).toHaveLength(2)
  expect(root.querySelector('.citation-unresolved')?.textContent).toContain('foreign')
})
it('labels snippets without fetching icons and refuses unsafe external URLs', () => {
  const wrapper = mount(MessageSources, {
    props: {
      prefix: 'source-',
      sources: [
        {
          id: 'w1',
          kind: 'web',
          title: 'Title',
          url: 'javascript:alert(1)',
          retrievedAt: '2026-10-19',
          representation: 'snippet_only',
          contentHash: 'hash',
        },
      ],
    },
  })
  expect(wrapper.text()).toContain('未读取全文')
  expect(wrapper.find('img').exists()).toBe(false)
  expect(wrapper.get('a').attributes('href')).toBeUndefined()
})

vi.mock('../../../platform/external-links', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../platform/external-links')>()),
  openWebUrl: vi.fn(),
}))
beforeEach(() => vi.mocked(openWebUrl).mockReset().mockResolvedValue())
const source: MessageSource = {
  id: 'w1',
  kind: 'web',
  title: '网页来源',
  url: 'https://example.com/article',
  retrievedAt: '2026-10-23',
  representation: 'snippet_only',
  contentHash: 'hash',
}

it('opens source links through the platform boundary and prevents default WebView navigation', async () => {
  const wrapper = mount(MessageSources, { props: { prefix: 'source-', sources: [source] } })
  const click = new MouseEvent('click', { bubbles: true, cancelable: true })
  wrapper.get('a').element.dispatchEvent(click)
  await flushPromises()
  expect(click.defaultPrevented).toBe(true)
  expect(openWebUrl).toHaveBeenCalledWith(source.url)
  wrapper.unmount()
})

it('shows a failed browser opening and lets the same source be retried', async () => {
  vi.mocked(openWebUrl)
    .mockRejectedValueOnce(new Error('无法打开系统浏览器，请重试或复制链接地址'))
    .mockResolvedValueOnce()
  const wrapper = mount(MessageSources, { props: { prefix: 'source-', sources: [source] } })
  await wrapper.get('a').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('无法打开系统浏览器')
  await wrapper.get('a').trigger('click')
  await flushPromises()
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  expect(openWebUrl).toHaveBeenCalledTimes(2)
  wrapper.unmount()
})

it('reveals and focuses only the cited source within the owning message', () => {
  const wrapper = mount(MessageSources, {
    attachTo: document.body,
    props: { prefix: 'message-', sources: [source, { ...source, id: 'w2' }] },
  })
  const selected = wrapper.get('[data-source-id="w2"]').element as HTMLElement
  const scroll = vi.fn()
  selected.scrollIntoView = scroll
  wrapper.vm.reveal('w2')
  expect(scroll).toHaveBeenCalledWith({ block: 'nearest' })
  expect(document.activeElement).toBe(selected)
  wrapper.vm.reveal('missing')
  expect(scroll).toHaveBeenCalledTimes(1)
  expect(openWebUrl).not.toHaveBeenCalled()
  wrapper.unmount()
})
