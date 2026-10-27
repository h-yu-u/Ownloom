import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { NInput } from 'naive-ui'
import VoiceCard from './VoiceCard.vue'
const voice = {
  id: 'voice',
  name: 'Original',
  reference_asset_id: 'asset',
  reference_text: 'reference',
  language: 'zh',
  source: 'self' as const,
  consent: true as const,
  consent_at: 1,
  created_at: 1,
  version: 1,
}
it('keeps text and edit mode on failed PATCH and exits only after success', async () => {
  const saveRequest = vi.fn(async () => false),
    wrapper = mount(VoiceCard, { props: { voice, busy: false, saveRequest } })
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '编辑')!
    .trigger('click')
  wrapper.findAllComponents(NInput)[0]!.vm.$emit('update:value', 'Edited')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '保存修改')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.findAllComponents(NInput)[0]!.props('value')).toBe('Edited')
  saveRequest.mockResolvedValueOnce(true)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '保存修改')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.findAllComponents(NInput)).toHaveLength(0)
  wrapper.unmount()
})
