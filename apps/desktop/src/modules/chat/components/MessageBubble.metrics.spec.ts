import { mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import MessageBubble from './MessageBubble.vue'
import type { ChatMessage } from '../domain/chat-state'

vi.mock('../../../platform/clipboard', () => ({ copyText: vi.fn() }))
const message: ChatMessage = {
  id: 'answer',
  role: 'assistant',
  content: 'Answer',
  state: 'complete',
  generationStats: { source: 'mlx-vlm', generationTokens: 30, generationTps: 15.25 },
}

it('renders final native statistics with the ordinary assistant reply', () => {
  const wrapper = mount(MessageBubble, { props: { message } })
  expect(wrapper.get('[aria-label="模型生成统计"]').text()).toContain('平均生成速度 15.3 tok/s')
  expect(wrapper.text()).toContain('输出 30 tokens')
  wrapper.unmount()
})

it.each<ChatMessage>([
  { ...message, state: 'error' },
  { ...message, state: 'cancelled' },
  { ...message, role: 'user' },
  { ...message, generationStats: undefined },
  { ...message, generationStats: null },
])('hides metrics for user, unsuccessful, and legacy messages: %j', (item) => {
  const wrapper = mount(MessageBubble, { props: { message: item } })
  expect(wrapper.find('[aria-label="模型生成统计"]').exists()).toBe(false)
  wrapper.unmount()
})
