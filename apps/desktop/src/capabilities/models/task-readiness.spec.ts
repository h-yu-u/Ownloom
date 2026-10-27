import { expect, it } from 'vitest'
import { modelFixture } from '../../test-fixtures/runtime'
import { deriveTaskReadiness } from './task-readiness'

it('distinguishes missing capability, explicit trial, queueing and unknown memory', () => {
  const model = modelFixture({ id: 'text' })
  expect(
    deriveTaskReadiness(model, { available: true }, { output: 'text', vision: true }).submitAllowed,
  ).toBe(false)
  expect(
    deriveTaskReadiness(model, { available: true }, { output: 'text', tools: true }).submitAllowed,
  ).toBe(false)
  const trial = deriveTaskReadiness(
    model,
    { available: true, busy: true },
    { output: 'text', tools: true },
    { allowTrial: true },
  )
  expect(trial.submitAllowed).toBe(true)
  expect(trial.dispatch).toBe('queue')
  expect(trial.capabilityEvidence).toBe('unverified')
  expect(trial.warnings.some((item) => item.code === 'MEMORY_ESTIMATE_UNKNOWN')).toBe(true)
  expect(deriveTaskReadiness(model, { available: false }, { output: 'text' }).submitAllowed).toBe(
    false,
  )
})
