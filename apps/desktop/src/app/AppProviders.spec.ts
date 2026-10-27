import { mount } from '@vue/test-utils'
import { NButton, useDialog } from 'naive-ui'
import { defineComponent, h, nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import AppProviders from './AppProviders.vue'

const DialogProbe = defineComponent({
  setup() {
    const dialog = useDialog()
    return () =>
      h(
        NButton,
        {
          onClick: () => dialog.info({ title: 'Provider works', content: 'Dialog content' }),
        },
        { default: () => 'Open dialog' },
      )
  },
})

describe('AppProviders', () => {
  it('provides the Naive UI dialog API to feature pages', async () => {
    const wrapper = mount(AppProviders, {
      attachTo: document.body,
      slots: { default: () => h(DialogProbe) },
    })
    await wrapper.get('button').trigger('click')
    await nextTick()
    expect(document.body.textContent).toContain('Provider works')
    wrapper.unmount()
  })
})
