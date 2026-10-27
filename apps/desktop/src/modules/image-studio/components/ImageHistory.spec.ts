import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ImageHistory from './ImageHistory.vue'

const artifact = {
  id: 'saved-image',
  job_id: 'job',
  model_id: 'model',
  model_name: 'Test model',
  prompt: 'a sunset lake',
  width: 512,
  height: 512,
  steps: 20,
  seed: 0,
  simulated: true,
  created_at: 1700000000,
}
describe('image history', () => {
  it('opens a saved artifact and visibly distinguishes simulated output', async () => {
    const wrapper = mount(ImageHistory, {
      props: {
        artifacts: [artifact],
        urls: {},
        errors: {},
        selectedId: null,
        loading: false,
        error: null,
        hasMore: false,
      },
    })
    expect(wrapper.text()).toContain('模拟输出')
    await wrapper.get('[aria-label="查看作品：a sunset lake"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['saved-image']])
    wrapper.unmount()
  })
})
