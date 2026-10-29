import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import type { CodingRun } from '../application/ports'
import CodingTimeline from './CodingTimeline.vue'
it('shows the actionable Runtime cause of a failed model task', () => {
  const run: CodingRun = {
    id: 'r',
    sessionId: 's',
    submissionId: 'one',
    text: 'build library',
    modelId: 'local',
    mode: 'develop',
    status: 'failed',
    phase: 'exploring',
    verification: 'not_run',
    error: 'TOOL_JSON_INVALID',
    createdAt: '',
    baseline: '',
    fingerprint: null,
    maxRepairRounds: 2,
  }
  const wrapper = mount(CodingTimeline, {
    props: {
      runs: [run],
      events: [
        {
          seq: 1,
          sessionId: 's',
          runId: 'r',
          type: 'assistant.message',
          text: '',
          data: { stopReason: 'error', error: 'TOOL_JSON_INVALID' },
        },
      ],
    },
  })
  expect(wrapper.text()).toContain('模型返回的 JSON 工具调用无效')
  expect(wrapper.find('details').text()).toContain('TOOL_JSON_INVALID')
  expect(wrapper.text()).not.toContain('MODEL_INFERENCE_FAILED')
  wrapper.unmount()
})

it('updates a streaming reply in place and shows the current command below it once', async () => {
  const event = (seq: number, type: string, text: string, data: object = {}) => ({
    seq,
    sessionId: 's',
    runId: 'r',
    type,
    text,
    data,
  })
  const events = [
    event(1, 'run.started', 'create project'),
    event(2, 'assistant.delta', 'First', { messageId: 'message' }),
  ]
  const run: CodingRun = {
    id: 'r',
    sessionId: 's',
    submissionId: 'one',
    text: 'create project',
    modelId: 'local',
    mode: 'develop',
    status: 'running',
    phase: 'generating',
    verification: 'not_run',
    createdAt: '',
    baseline: '',
    fingerprint: null,
    maxRepairRounds: 2,
    error: null,
  }
  const wrapper = mount(CodingTimeline, {
    props: { runs: [run], events },
    global: { stubs: { RouterLink: true } },
  })
  expect(wrapper.findAll('article')).toHaveLength(2)
  await wrapper.setProps({
    events: [
      ...events,
      event(3, 'assistant.message', 'First reply', { messageId: 'message' }),
      event(4, 'tool.started', 'run_command', { toolCallId: 'command' }),
      event(5, 'command.started', 'pnpm build', { toolCallId: 'command' }),
    ],
    runs: [{ ...run, phase: 'executing' }],
  })
  expect(wrapper.findAll('article')).toHaveLength(2)
  expect(wrapper.findAll('article')[1]?.text()).toBe('First reply')
  expect(wrapper.get('.coding-activity > summary').text()).toBe('正在构建项目')
  expect(wrapper.get('.activity-command').text()).toBe('pnpm build')
  expect(wrapper.get('.coding-activity > summary').text()).not.toContain('pnpm build')
  expect(wrapper.find('footer').exists()).toBe(false)
  await wrapper.setProps({ runs: [{ ...run, status: 'completed' }] })
  expect(wrapper.get('.coding-activity > summary').text()).toBe('构建项目 · 已结束')
  expect(wrapper.find('footer').exists()).toBe(false)
  await wrapper.setProps({ runs: [{ ...run, status: 'cancelled' }] })
  expect(wrapper.get('.coding-activity > summary').text()).toBe('构建项目 · 已停止')
  expect(wrapper.find('.coding-activity .activity-spinner').exists()).toBe(false)
  await wrapper.setProps({ runs: [{ ...run, status: 'failed' }] })
  expect(wrapper.get('.coding-activity > summary').text()).toBe('构建项目 · 失败')
  wrapper.unmount()
})
