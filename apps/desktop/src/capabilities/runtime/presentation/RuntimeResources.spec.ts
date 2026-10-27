import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import RuntimeResources from './RuntimeResources.vue'

it('uses real memory percentage for the progress bar and presents unavailable data explicitly', async () => {
  const wrapper = mount(RuntimeResources, {
    props: {
      systemMemory: '32.0 / 64.0 GB',
      memoryPercent: 50,
      workerMemory: '20.0 GB',
      diskFree: '500.0 GB',
    },
  })
  expect(wrapper.text()).toContain('32.0 / 64.0 GB')
  expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('50')
  expect(wrapper.get('[role="progressbar"] span').attributes('style')).toContain('50%')
  await wrapper.setProps({ systemMemory: '—', memoryPercent: null, workerMemory: '—' })
  expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBeUndefined()
  expect(wrapper.get('[role="progressbar"]').attributes('aria-valuetext')).toBe('—')
  wrapper.unmount()
})
