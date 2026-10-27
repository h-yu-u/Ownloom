import { mount } from '@vue/test-utils'
import { NInput } from 'naive-ui'
import { expect, it } from 'vitest'
import CodingComposer from './CodingComposer.vue'

it('uses the same busy action for buttons and shortcuts and respects preparation and IME', async () => {
  const wrapper = mount(CodingComposer, {
    props: {
      modelValue: 'task',
      models: [{ label: 'Model', value: 'm' }],
      modelId: 'm',
      mode: 'develop',
      ready: true,
      busy: true,
      pending: false,
      enabled: true,
      currentSessionActive: true,
      activeStatus: 'running',
    },
  })
  await wrapper.get('button[aria-label="补充当前任务"]').trigger('click')
  wrapper
    .getComponent(NInput)
    .vm.$emit('keydown', new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }))
  expect(wrapper.emitted('steer')).toHaveLength(2)
  await wrapper.setProps({ currentSessionActive: false })
  wrapper
    .getComponent(NInput)
    .vm.$emit('keydown', new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))
  expect(wrapper.emitted('queue')).toHaveLength(1)
  await wrapper.setProps({ currentSessionActive: true, activeStatus: 'starting' })
  wrapper
    .getComponent(NInput)
    .vm.$emit('keydown', new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }))
  expect(wrapper.emitted('steer')).toHaveLength(2)
  await wrapper.setProps({ activeStatus: 'running' })
  await wrapper.get('textarea').trigger('compositionstart')
  wrapper
    .getComponent(NInput)
    .vm.$emit('keydown', new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }))
  await wrapper.get('textarea').trigger('compositionend')
  wrapper
    .getComponent(NInput)
    .vm.$emit(
      'keydown',
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, repeat: true }),
    )
  expect(wrapper.emitted('steer')).toHaveLength(2)
  wrapper.unmount()
})
