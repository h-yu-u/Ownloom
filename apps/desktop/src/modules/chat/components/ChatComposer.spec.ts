import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChatComposer from './ChatComposer.vue'

const baseProps = {
  busy: false,
  imageLimit: 0,
  draft: 'hello',
  images: [] as File[],
}

describe('ChatComposer', () => {
  it('uses one attachment button and an accessible network toggle without removing incompatible attachments', async () => {
    const wrapper = mount(ChatComposer, { props: { ...baseProps, webEnabled: true } })
    expect(wrapper.findAll('input[type=file]')).toHaveLength(1)
    expect(wrapper.find('button[aria-label="添加附件"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="添加图片附件"]').exists()).toBe(false)
    expect(wrapper.get('[aria-label="联网已开启"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('[aria-label="联网已开启"]').trigger('click')
    expect(wrapper.emitted('toggleWeb')).toHaveLength(1)
    await wrapper.setProps({ imageLimit: 4 })
    await wrapper.setProps({ imageLimit: 0 })
    expect(wrapper.emitted('update:images')).toBeUndefined()
  })
  it('does not discard or submit a draft while generation is active', async () => {
    const wrapper = mount(ChatComposer, { props: { ...baseProps, busy: true, generating: true } })
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.emitted('update:draft')).toBeUndefined()
    expect(wrapper.props('draft')).toBe('hello')
    await wrapper.get('button[aria-label="停止生成"]').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('update:draft')).toBeUndefined()
    wrapper.unmount()
  })

  it('does not submit when Enter confirms Chinese input or inserts a line break', async () => {
    const wrapper = mount(ChatComposer, { props: baseProps })
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', isComposing: true })
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.emitted('submit')).toBeUndefined()
    wrapper.unmount()
  })

  it('shows a pending send instead of cancellation before a job starts', () => {
    const wrapper = mount(ChatComposer, { props: { ...baseProps, busy: true, generating: false } })
    expect(wrapper.text()).not.toContain('停止生成')
    expect(
      wrapper
        .findAll('button')
        .find((button) => button.text() === '发送')
        ?.attributes('disabled'),
    ).toBeDefined()
    wrapper.unmount()
  })

  it('requests submission without clearing controlled draft state', async () => {
    const wrapper = mount(ChatComposer, { props: baseProps })
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('submit')).toHaveLength(1)
    expect(wrapper.emitted('update:draft')).toBeUndefined()
    expect(wrapper.props('draft')).toBe('hello')
  })
})
