import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ApprovalCard from './ApprovalCard.vue'
const approval = {
  id: 'a',
  runId: 'r',
  sessionId: 's',
  toolCallId: 't',
  action: 'command' as const,
  parameters: { command: 'pnpm test' },
  command: 'pnpm test',
  cwd: '/local project',
  policyVersion: 1 as const,
  expiresAt: Date.now() + 1000,
  status: 'pending' as const,
}
describe('one-time approval UI', () => {
  it('shows the exact command and local privilege boundary and emits separate decisions', async () => {
    const wrapper = mount(ApprovalCard, { props: { approval, pending: false } })
    expect(wrapper.text()).toContain('pnpm test')
    expect(wrapper.text()).toContain('/local project')
    expect(wrapper.text()).toContain('本机用户权限')
    await wrapper.findAll('button')[0]!.trigger('click')
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(wrapper.emitted('resolve')).toEqual([
      ['a', true],
      ['a', false],
    ])
  })
})
