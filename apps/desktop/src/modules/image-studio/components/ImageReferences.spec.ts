import { mount } from '@vue/test-utils'
import { NUpload } from 'naive-ui'
import { describe, expect, it, vi } from 'vitest'
import ImageReferences from './ImageReferences.vue'

describe('reference image upload', () => {
  it('keeps all files when the uploader emits changes across separate ticks', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = mount(ImageReferences, {
        props: { ids: [], urls: {}, names: {}, locked: false, uploading: false },
      })
      const first = new File(['1'], 'one.png', { type: 'image/png' })
      const second = new File(['2'], 'two.png', { type: 'image/png' })
      const upload = wrapper.findComponent(NUpload)
      upload.vm.$emit('change', { file: { id: 'one', file: first } })
      await Promise.resolve()
      upload.vm.$emit('change', { file: { id: 'two', file: second } })
      await vi.runAllTimersAsync()
      expect(wrapper.emitted('upload')).toEqual([[[first, second]]])
      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
