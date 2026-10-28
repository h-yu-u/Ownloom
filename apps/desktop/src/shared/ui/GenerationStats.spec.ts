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
