import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { RuntimeError } from '@mlx-studio/api-client'
import { modelFixture } from '../../../test-fixtures/runtime'
import { createModelsGateway } from '../infrastructure/models-gateway'
import { createDraftController, initialDraft } from './draft-controller'
import DraftSettingsModal from '../components/DraftSettingsModal.vue'

function fixture() {
  const gateway = {
    ...createModelsGateway(async () => {
      throw new Error('unused transport')
    }),
    configureDraft: vi.fn().mockResolvedValue({}),
  }
  const deps = { gateway, pickDirectory: vi.fn(), refresh: vi.fn() }
  return { ...deps, controller: createDraftController(deps) }
}

describe('draft acceleration settings', () => {
  it('defaults off and requires both paths for auto mode', async () => {
    const { controller, gateway } = fixture()
    controller.showDraft(modelFixture({ id: 'qwen' }))
    expect(controller.draftSettings.value.enabled).toBe(false)
    controller.draftSettings.value.enabled = true
    controller.draftSettings.value.mtpPath = '/mtp'
    expect(await controller.saveDraft()).toBe(false)
    expect(gateway.configureDraft).not.toHaveBeenCalled()
    controller.draftSettings.value.dflashPath = '/dflash'
    gateway.configureDraft.mockRejectedValue(new Error('incompatible draft'))
    expect(await controller.saveDraft()).toBe(false)
    expect(controller.draftModel.value?.id).toBe('qwen')
    expect(controller.draftError.value).toBe('incompatible draft')
    expect(controller.draftSaving.value).toBe(false)
  })
  it('migrates legacy MTP and preserves paths when turning the switch off', async () => {
    const { controller, gateway, refresh } = fixture()
    const model = modelFixture({ id: 'qwen', mtp: { draftPath: '/old', blockSize: 4 } })
    controller.showDraft(model)
    expect(controller.draftSettings.value).toMatchObject({
      enabled: true,
      mode: 'mtp',
      mtpBlockSize: 4,
    })
    controller.draftSettings.value.enabled = false
    expect(await controller.saveDraft()).toBe(true)
    expect(gateway.configureDraft).toHaveBeenCalledWith('qwen', {
      enabled: false,
      mode: 'mtp',
      mtpPath: '/old',
      dflashPath: null,
      mtpBlockSize: 4,
      dflashBlockSize: 5,
    })
    expect(refresh).toHaveBeenCalledOnce()
    expect(controller.draftModel.value).toBeNull()
    expect(model.mtp?.draftPath).toBe('/old')
  })
  it('ignores a late directory response, including closing and reopening the same model', async () => {
    const { controller, pickDirectory } = fixture()
    let finish!: (path: string) => void
    pickDirectory.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve
      }),
    )
    const model = modelFixture({ id: 'qwen' })
    controller.showDraft(model)
    const pending = controller.pickDraftDirectory('dflash2')
    controller.closeDraft()
    controller.showDraft(model)
    finish('/late')
    await pending
    expect(controller.draftSettings.value.dflashPath).toBeNull()
  })
  it('keeps editable settings after a busy rejection and can retry after the run stops', async () => {
    const { controller, gateway, refresh } = fixture()
    const model = modelFixture({ id: 'qwen' })
    controller.showDraft(model)
    controller.draftSettings.value.mtpPath = '/selected'
    gateway.configureDraft.mockRejectedValueOnce(
      new RuntimeError('模型仍被任务引用，请等待结束或先停止任务', 'MODEL_IN_USE', 409, true),
    )
    expect(await controller.saveDraft()).toBe(false)
    expect(controller.draftSaving.value).toBe(false)
    expect(controller.draftModel.value?.id).toBe(model.id)
    expect(controller.draftSettings.value.mtpPath).toBe('/selected')
    expect(controller.draftError.value).toContain('等待结束或先停止任务')
    expect(refresh).not.toHaveBeenCalled()
    expect(model.draft).toBeUndefined()
    expect(await controller.saveDraft()).toBe(true)
    expect(refresh).toHaveBeenCalledOnce()
    expect(controller.draftModel.value).toBeNull()
  })
  it('renders an accessible enable switch and emits the updated settings', async () => {
    const settings = initialDraft()
    const wrapper = mount(DraftSettingsModal, {
      props: { model: modelFixture({}), settings, saving: false, error: null },
      global: { stubs: { Modal: { template: '<div><slot /></div>' } } },
    })
    try {
      const toggle = wrapper.get('[role="switch"]')
      expect(toggle.attributes('aria-label')).toBe('开启草稿加速')
      await toggle.trigger('click')
      expect(wrapper.emitted('update:settings')?.[0]).toEqual([{ ...settings, enabled: true }])
    } finally {
      wrapper.unmount()
    }
  })
})
