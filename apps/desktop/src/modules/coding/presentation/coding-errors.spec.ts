import { expect, it } from 'vitest'
import { RuntimeError } from '@mlx-studio/api-client'
import { codingErrorText, codingRunErrorText } from './coding-errors'

it('gives an actionable message when model settings and a run compete', () => {
  const error = new RuntimeError('模型正在更新', 'MODEL_IN_USE', 409, true)
  expect(codingErrorText(error)).toContain('等待完成或先停止相关任务')
  expect(codingRunErrorText('MODEL_IN_USE')).toContain('MODEL_IN_USE')
})

it('preserves identity failures and explains how to start a fresh run', () => {
  expect(codingRunErrorText('CAPABILITY_MODEL_CHANGED')).toBe(
    '任务使用的模型配置已改变，请重新验证模型工具能力后提交新任务。（CAPABILITY_MODEL_CHANGED）',
  )
})
