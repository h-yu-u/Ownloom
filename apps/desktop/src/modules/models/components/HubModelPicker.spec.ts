import { useModelDirectoryState } from '../../../capabilities/models/directory'
import { installWorkspaces } from '../../../app/composition-root'
import { modelFixture } from '../../../test-fixtures/runtime'
import { flushPromises, mount } from '@vue/test-utils'
import { NSelect } from 'naive-ui'
import { createPinia, setActivePinia } from 'pinia'
import { h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppProviders from '../../../app/AppProviders.vue'
import { useModelsStore } from '../stores/models.store'
import HubModelPicker from '../presentation/HubModelPickerContainer.vue'

const model = {
  repo_id: 'mlx-community/example',
  downloads: 100,
  likes: 12,
  task: 'text-generation',
  updated_at: null,
}

function renderPicker(): ReturnType<typeof mount> {
  return mount(AppProviders, { slots: { default: () => h(HubModelPicker) } })
}

describe('HubModelPicker', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useModelsStore().catalog = [model]
  })

  it('requires selection before downloading and does not download on selection alone', async () => {
    const store = useModelsStore()
    const pull = vi.spyOn(store, 'pullModel').mockResolvedValue(true)
    const wrapper = renderPicker()
    const button = () => wrapper.findAll('button').find((item) => item.text() === '下载模型')
    expect(button()?.attributes('disabled')).toBeDefined()
    wrapper.getComponent(NSelect).vm.$emit('update:value', model.repo_id)
    await flushPromises()
    expect(wrapper.text()).toContain('text-generation · 100 次下载 · 12 个赞')
    expect(button()?.attributes('disabled')).toBeUndefined()
    expect(pull).not.toHaveBeenCalled()
    await button()?.trigger('click')
    expect(pull).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('disables repeat downloads of an installed repository', () => {
    const store = useModelsStore()
    store.selectHubModel(model.repo_id)
    useModelDirectoryState().items = [
      modelFixture({
        id: 'local',
        displayName: model.repo_id,
        source: 'huggingface',
        engine: 'mlx-lm',
        task: 'text-generation',
        state: 'available',
        localPath: '/models/example',
      }),
    ]
    const wrapper = renderPicker()
    expect(wrapper.text()).toContain('已在本地')
    expect(
      wrapper
        .findAll('button')
        .find((item) => item.text() === '已在本地')
        ?.attributes('disabled'),
    ).toBeDefined()
    wrapper.unmount()
  })

  it('renders download errors and keeps the selected model available to retry', () => {
    const store = useModelsStore()
    store.selectHubModel(model.repo_id)
    store.downloadError = '模型下载失败'
    const wrapper = renderPicker()
    expect(wrapper.get('[role="alert"]').text()).toContain('可点击“下载模型”重试')
    expect(
      wrapper
        .findAll('button')
        .find((item) => item.text() === '下载模型')
        ?.attributes('disabled'),
    ).toBeUndefined()
    wrapper.unmount()
  })
})

installWorkspaces()
