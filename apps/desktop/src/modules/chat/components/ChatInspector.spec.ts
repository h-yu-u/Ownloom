import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChatInspector from './ChatInspector.vue'
import NumericParameterField from '../../../shared/ui/NumericParameterField.vue'
const runtime = { error: null, info: {}, uptime: '—', diskFree: '—' }
describe('ChatInspector', () => {
  it('defaults to automatic output and allows manual limits above 8192 for a large model', async () => {
    const wrapper = mount(ChatInspector, {
      props: {
        busy: false,
        runtime,
        selectedModel: {
          displayName: 'Large context model',
          engine: 'mlx-lm',
          inputModalities: ['text'],
          contextLength: 262144,
        },
      },
    })
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.find('#max-tokens').exists()).toBe(false)
    expect(wrapper.get('[role="status"]').text()).toContain('剩余空间')
    await wrapper.setProps({ maxTokens: 32768 })
    const output = wrapper.findAllComponents(NumericParameterField)[0]!
    expect(output.props('modelValue')).toBe(32768)
    expect(output.props('max')).toBe(262016)
    await wrapper.get('[role="switch"]').trigger('click')
    expect(wrapper.emitted('update:maxTokens')?.at(-1)).toEqual([null])
    wrapper.unmount()
  })
  it('emits reset without requiring a Store and disables unsupported settings', async () => {
    const wrapper = mount(ChatInspector, {
      props: {
        clearing: false,
        busy: false,
        messageCount: 0,
        runtime,
        maxTokens: 1024,
        temperature: 1.3,
      },
    })
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '重置')
      ?.trigger('click')
    expect(wrapper.emitted('reset')).toHaveLength(1)
    expect(wrapper.findAll('[role="slider"][aria-disabled="true"]')).toHaveLength(2)
    wrapper.unmount()
  })
  it('locks actions and parameters while a request is pending', () => {
    const wrapper = mount(ChatInspector, {
      props: { clearing: false, busy: true, messageCount: 1, runtime },
    })
    expect(
      wrapper.findAll('button').every((button) => button.attributes('disabled') !== undefined),
    ).toBe(true)
    expect(
      wrapper.findAll('input').every((input) => input.attributes('disabled') !== undefined),
    ).toBe(true)
    wrapper.unmount()
  })
})
