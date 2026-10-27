import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import MarkdownContent from './MarkdownContent.vue'
import { openWebUrl } from '../../platform/external-links'

vi.mock('../../platform/external-links', () => ({ openWebUrl: vi.fn() }))
beforeEach(() => vi.mocked(openWebUrl).mockReset().mockResolvedValue())

it('opens ordinary Markdown web links through the same desktop-safe boundary', async () => {
  const wrapper = mount(MarkdownContent, {
    props: { contentId: 'answer', source: '[GitHub](https://github.com/trending)' },
  })
  await wrapper.get('a').trigger('click')
  expect(openWebUrl).toHaveBeenCalledWith('https://github.com/trending')
  wrapper.unmount()
})

it('prevents citation fragments from reaching the router and emits the known source ID', async () => {
  const wrapper = mount(MarkdownContent, {
    props: { contentId: 'answer', source: '[[cite:w1]]', citations: { w1: '#source-answer-w1' } },
  })
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  wrapper.get('a').element.dispatchEvent(event)
  await flushPromises()
  expect(event.defaultPrevented).toBe(true)
  expect(wrapper.emitted('openCitation')).toEqual([['w1']])
  expect(openWebUrl).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('reports Markdown link opening failures in the message', async () => {
  vi.mocked(openWebUrl).mockRejectedValueOnce(new Error('无法打开系统浏览器'))
  const wrapper = mount(MarkdownContent, {
    props: { contentId: 'answer', source: '[Source](https://example.com)' },
  })
  await wrapper.get('a').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toBe('无法打开系统浏览器')
  wrapper.unmount()
})
