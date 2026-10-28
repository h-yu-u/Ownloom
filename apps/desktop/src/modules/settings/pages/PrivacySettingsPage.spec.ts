import { expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createDataManagement } from '../../../capabilities/data'
import { createDataController } from '../../../capabilities/data/controller'
import PrivacySettingsPage from './PrivacySettingsPage.vue'

vi.mock('../../../capabilities/data', () => ({ createDataManagement: vi.fn() }))

it('lets the user cancel a restore preview and releases a replacement on unmount', async () => {
  const discardPreview = vi.fn(async () => ({ discarded: true }))
  const data = createDataController({
    storage: vi.fn(async () => ({
      bytes: 0,
      categories: {},
      automaticCleanup: false,
      trash: [],
      candidates: [],
    })),
    cleanup: vi.fn(),
    restore: vi.fn(),
    backup: vi.fn(),
    inspect: vi.fn(),
    activate: vi.fn(),
    rollback: vi.fn(),
    restart: vi.fn(),
    discardPreview,
  })
  data.preview.value = { id: 'first', bytes: 100, files: 2, warnings: [] }
  vi.mocked(createDataManagement).mockReturnValue(data)
  const wrapper = mount(PrivacySettingsPage, {
    global: {
      stubs: {
        PageHeader: true,
        NAlert: true,
        NSpace: { template: '<div><slot /></div>' },
        NButton: {
          props: ['disabled'],
          template: '<button :disabled="disabled"><slot /></button>',
        },
      },
    },
  })
  try {
    await flushPromises()
    const cancel = wrapper.findAll('button').find((button) => button.text() === '取消预览')
    expect(cancel).toBeDefined()
    await cancel?.trigger('click')
    await flushPromises()
    expect(discardPreview).toHaveBeenCalledWith('first')
    data.preview.value = { id: 'second', bytes: 100, files: 2, warnings: [] }
  } finally {
    wrapper.unmount()
  }
  expect(discardPreview).toHaveBeenCalledWith('second')
})
