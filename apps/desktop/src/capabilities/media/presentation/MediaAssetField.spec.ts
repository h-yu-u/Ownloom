import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { configureMediaAssets } from '../configuration'
import type { AssetCatalog } from '../application/asset-catalog'
import type { AttachmentMetadata } from '@mlx-studio/api-client'
import MediaAssetField from './MediaAssetField.vue'
import AssetPickerDialog from './AssetPickerDialog.vue'
const attachment: AttachmentMetadata = {
  id: 'attachment',
  kind: 'image',
  format: 'png',
  mimeType: 'image/png',
  originalName: 'reference.png',
  sizeBytes: 10,
  sha256: '',
  processing: null,
}
describe('asset preparation destination ownership', () => {
  it('does not adopt an upload after closing and blocks duplicate confirmation', async () => {
    let finish!: (value: AttachmentMetadata) => void
    const catalog: AssetCatalog = {
      images: async () => [
        {
          id: 'a',
          job_id: 'j',
          model_id: 'm',
          model_name: 'model',
          prompt: 'example',
          width: 64,
          height: 64,
          steps: 1,
          seed: 0,
          simulated: true,
          mode: 'generate',
          strength: 1,
          created_at: 1,
        },
      ],
      voices: async () => [],
      metadata: async () => attachment,
      imageContent: vi.fn(async () => new Blob()),
      attachmentContent: vi.fn(),
      voiceContent: vi.fn(),
      upload: vi.fn(
        () =>
          new Promise<AttachmentMetadata>((resolve) => {
            finish = resolve
          }),
      ),
    }
    configureMediaAssets(() => catalog)
    const wrapper = mount(MediaAssetField, {
      props: { kind: 'image', ids: [], targetKey: 'session:A' },
      global: { stubs: { AssetPickerDialog: true } },
    })
    await wrapper.get('button').trigger('click')
    await flushPromises()
    const dialog = wrapper.getComponent(AssetPickerDialog)
    dialog.vm.$emit('select', 'artifact:a')
    dialog.vm.$emit('confirm')
    dialog.vm.$emit('confirm')
    await flushPromises()
    expect(catalog.upload).toHaveBeenCalledOnce()
    dialog.vm.$emit('close')
    finish(attachment)
    await flushPromises()
    expect(wrapper.emitted('change')).toBeUndefined()
    wrapper.unmount()
  })
})
