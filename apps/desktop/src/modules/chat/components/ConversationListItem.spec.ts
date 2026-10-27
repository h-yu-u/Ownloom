import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { NDropdown } from 'naive-ui'
import ConversationListItem from './ConversationListItem.vue'
const props = {
  conversation: { id: 'id', title: '研究计划', pinned: false },
  active: false,
  disabled: false,
}

describe('ConversationListItem', () => {
  it('keeps open, pin and menu actions separate and exposes rename and delete', async () => {
    const wrapper = mount(ConversationListItem, { props })
    await wrapper.get('[aria-label="置顶：研究计划"]').trigger('click')
    expect(wrapper.emitted('pin')).toHaveLength(1)
    expect(wrapper.emitted('open')).toBeUndefined()
    const menu = wrapper.getComponent(NDropdown)
    expect(menu.props('options')?.map(({ key, label }) => ({ key, label }))).toEqual([
      { label: '重命名', key: 'rename' },
      { label: '删除', key: 'delete' },
    ])
    menu.vm.$emit('select', 'rename')
    menu.vm.$emit('select', 'delete')
    expect(wrapper.emitted('rename')).toHaveLength(1)
    expect(wrapper.emitted('remove')).toHaveLength(1)
    await wrapper.get('.session-title').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
    await wrapper.setProps({
      conversation: { ...props.conversation, pinned: true },
      disabled: true,
    })
    expect(wrapper.get('[aria-label="取消置顶：研究计划"]').attributes('aria-pressed')).toBe('true')
    expect(
      wrapper.findAll('button').every((button) => button.attributes('disabled') !== undefined),
    ).toBe(true)
    wrapper.unmount()
  })
})
