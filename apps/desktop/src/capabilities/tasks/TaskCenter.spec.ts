import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { expect, it, vi } from 'vitest'
import { createTaskCenter } from './controller'
import { configureTaskCenter } from './store'
import TaskCenter from './TaskCenter.vue'
import type { TaskSummary } from '@mlx-studio/api-client'

it('distinguishes loading, error and empty states and allows retrying from the panel', async () => {
  let rejectRequest: (reason: Error) => void = () => {}
  const tasks = vi
    .fn()
    .mockImplementationOnce(() => new Promise((_, reject) => (rejectRequest = reject)))
    .mockResolvedValue([])
  configureTaskCenter(() => createTaskCenter({ tasks, download: vi.fn() }))
  const wrapper = mount(TaskCenter, {
    global: {
      plugins: [createPinia()],
      stubs: {
        Drawer: { template: '<section v-if="show"><slot /></section>', props: ['show'] },
        DrawerContent: { template: '<div><slot /></div>' },
        Spin: true,
        RouterLink: true,
      },
    },
  })
  await wrapper.get('button.task-center-button').trigger('click')
  expect(wrapper.text()).toContain('正在加载任务')
  expect(wrapper.text()).not.toContain('暂无任务')
  rejectRequest(new TypeError('Load failed'))
  await flushPromises()
  expect(wrapper.text()).toContain('请重试')
  expect(wrapper.text()).not.toContain('暂无任务')
  expect(wrapper.text()).not.toContain('Load failed')
  const retry = wrapper.findAll('button').find((button) => button.text() === '重试')!
  await retry.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('暂无任务')
  expect(wrapper.text()).not.toContain('请重试')
  expect(tasks).toHaveBeenCalledTimes(2)
  wrapper.unmount()
})

it('renders one named card and one destination per session with collapsed execution history', async () => {
  const parent: TaskSummary = {
    id: 'run',
    owner: 'coding',
    groupId: 'coding:session',
    title: '优化任务面板',
    kind: 'coding',
    sessionId: 'session',
    state: 'running',
    phase: 'running',
    target: '/coding',
    needsApproval: false,
  }
  const child = {
    ...parent,
    id: 'step',
    owner: 'runtime',
    kind: 'coding-inference',
    parentId: parent.id,
  }
  configureTaskCenter(() =>
    createTaskCenter({ tasks: vi.fn().mockResolvedValue([parent, child]), download: vi.fn() }),
  )
  const wrapper = mount(TaskCenter, {
    global: {
      plugins: [createPinia()],
      stubs: {
        Drawer: { template: '<section v-if="show"><slot /></section>', props: ['show'] },
        DrawerContent: { template: '<div><slot /></div>' },
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  })
  await flushPromises()
  await wrapper.get('button.task-center-button').trigger('click')
  expect(wrapper.findAll('.task-card')).toHaveLength(1)
  expect(wrapper.get('.task-card-heading h3').text()).toBe('优化任务面板')
  expect(wrapper.findAll('.task-card-actions a')).toHaveLength(1)
  expect(wrapper.get('details summary').text()).toBe('2 条执行记录')
  expect(wrapper.get('details').attributes('open')).toBeUndefined()
  expect(wrapper.get('button.task-center-button').attributes('aria-label')).toContain('1 个进行中')
  wrapper.unmount()
})
