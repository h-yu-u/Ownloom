import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import GenerationStats from './GenerationStats.vue'
import type { GenerationStatsView } from '../lib/generation-stats'

const stats: GenerationStatsView = { source: 'mlx-lm', generationTokens: 24, generationTps: 17.25 }

it('shows the native average for streaming and completed replies without recalculating it', async () => {
  const wrapper = mount(GenerationStats, { props: { stats, streaming: true } })
  expect(wrapper.text()).toContain('当前平均生成速度 17.3 tok/s')
  expect(wrapper.text()).toContain('输出 24 tokens')
  expect(wrapper.attributes('aria-live')).toBe('off')
  await wrapper.setProps({ streaming: false })
  expect(wrapper.text()).toContain('平均生成速度 17.3 tok/s')
  expect(wrapper.text()).not.toContain('当前')
  wrapper.unmount()
})

it('waits for initial streaming samples but displays the exact native final statistic', async () => {
  const wrapper = mount(GenerationStats, {
    props: { stats: { ...stats, generationTokens: 1, generationTps: 12345.6 }, streaming: true },
  })
  expect(wrapper.text()).toContain('统计中')
  expect(wrapper.text()).not.toContain('12345.6')
  await wrapper.setProps({ streaming: false })
  expect(wrapper.text()).toContain('12345.6 tok/s')
  wrapper.unmount()
})

it('distinguishes missing values from real zero values', async () => {
  const wrapper = mount(GenerationStats, {
    props: { stats: { ...stats, generationTokens: null, generationTps: null } },
  })
  expect(wrapper.text()).toContain('— tok/s')
  expect(wrapper.text()).toContain('输出 — tokens')
  await wrapper.setProps({ stats: { ...stats, generationTokens: 0, generationTps: 0 } })
  expect(wrapper.text()).toContain('0.0 tok/s')
  expect(wrapper.text()).toContain('输出 0 tokens')
  wrapper.unmount()
})

it.each([null, undefined])('hides the row when no native statistics exist: %s', (value) => {
  const wrapper = mount(GenerationStats, { props: { stats: value } })
  expect(wrapper.find('[aria-label="模型生成统计"]').exists()).toBe(false)
  wrapper.unmount()
})

it('separates measured input preparation and inference latency from the native output rate', () => {
  const wrapper = mount(GenerationStats, {
    props: {
      stats: {
        ...stats,
        draftMode: 'dflash2',
        promptTokens: 14315,
        cachedTokens: 14275,
        prefillTokens: 40,
        prefillMs: 300.5,
        firstTokenMs: 390,
        durationMs: 1302,
      },
    },
  })
  expect(wrapper.text()).toContain('17.3 tok/s')
  expect(wrapper.text()).toContain('DFlash2 草稿')
  const details = wrapper.get('dl')
  expect(details.text()).toContain('输入总量14315 tokens')
  expect(details.text()).toContain('缓存复用14275 tokens')
  expect(details.text()).toContain('本轮输入处理40 tokens')
  expect(details.text()).toContain('输入准备300.5 ms')
  expect(details.text()).toContain('首字等待390 ms')
  expect(details.text()).toContain('本轮推理1.30 s')
  expect(
    wrapper
      .findAll('dt')
      .find((item) => item.text() === '本轮推理')
      ?.attributes('title'),
  ).toContain('不含排队')
  wrapper.unmount()
})

it('keeps legacy replies readable without estimating unrecorded fields', () => {
  const wrapper = mount(GenerationStats, {
    props: { stats: { ...stats, promptTokens: 100, cachedTokens: 80 } },
  })
  expect(wrapper.text()).toContain('输入总量100 tokens')
  expect(wrapper.text()).not.toContain('本轮输入处理')
  expect(wrapper.text()).not.toContain('输入准备')
  expect(wrapper.text()).not.toContain('首字等待')
  expect(wrapper.text()).not.toContain('本轮推理')
  expect(wrapper.text()).not.toContain('草稿')
  wrapper.unmount()
})

it('shows measured zeros and the actual disabled draft path', () => {
  const wrapper = mount(GenerationStats, {
    props: {
      stats: {
        ...stats,
        draftMode: 'none',
        cachedTokens: 0,
        prefillMs: 0,
      },
    },
  })
  expect(wrapper.text()).toContain('本轮未使用草稿')
  expect(wrapper.text()).toContain('缓存复用0 tokens')
  expect(wrapper.text()).toContain('输入准备0 ms')
  expect(wrapper.text()).not.toContain('首字等待')
  wrapper.unmount()
})
