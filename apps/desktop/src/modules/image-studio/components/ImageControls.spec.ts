import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { NRadioGroup, NButton } from 'naive-ui'
import { modelFixture } from '../../../test-fixtures/runtime'
import ImageControls from './ImageControls.vue'

const base = {
  modelId: 'text-only',
  prompt: 'make it blue',
  width: 512,
  height: 512,
  steps: 20,
  seed: null,
}
const models = [
  modelFixture({ id: 'text-only', task: 'image-generation' }),
  modelFixture({
    id: 'editor',
    task: 'image-generation',
    capabilities: { imageEditing: true, inpainting: true, multiImage: true },
  }),
]
function render(form = base) {
  return mount(ImageControls, {
    props: {
      form,
      models,
      locked: false,
      submitting: false,
      uploading: false,
      inputError: null,
      inputUrls: {},
      inputNames: {},
    },
    global: { stubs: { RouterLink: true } },
  })
}
describe('image creation controls', () => {
  it('selects a compatible model and useful defaults when switching to editing', () => {
    const wrapper = render()
    wrapper.findComponent(NRadioGroup).vm.$emit('update:value', 'edit')
    expect(wrapper.emitted('update:form')?.[0]?.[0]).toMatchObject({
      mode: 'edit',
      modelId: 'editor',
      steps: 40,
    })
  })
  it('blocks editing until the user supplies references and a mask for inpainting', async () => {
    const wrapper = render()
    await wrapper.setProps({
      form: { ...base, modelId: 'editor', mode: 'inpaint', referenceIds: ['source'] },
    })
    const submit = wrapper
      .findAllComponents(NButton)
      .find((button) => button.text().includes('开始编辑'))
    expect(submit?.props('disabled')).toBe(true)
    await wrapper.setProps({
      form: {
        ...base,
        modelId: 'editor',
        mode: 'inpaint',
        referenceIds: ['source'],
        maskId: 'mask',
      },
    })
    expect(submit?.props('disabled')).toBe(false)
  })
})
