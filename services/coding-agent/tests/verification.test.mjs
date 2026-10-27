import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verificationStatus } from '../dist/domain/verification.js'
const run = { id: 'run', verificationCommands: ['test', 'lint'] }
const check = (command, patch = {}) => ({
  runId: 'run',
  command,
  purpose: 'verification',
  fingerprint: 'current',
  stale: false,
  exitCode: 0,
  ...patch,
})
test('ordinary commands and legacy records cannot prove verification', () => {
  assert.equal(verificationStatus({ id: 'run' }, [check('pwd')], 'current'), 'not_run')
  assert.equal(
    verificationStatus(run, [check('test', { purpose: 'command' })], 'current'),
    'not_run',
  )
  assert.equal(
    verificationStatus(run, [check('test', { purpose: undefined })], 'current'),
    'not_run',
  )
})
test('requires every frozen step and fresh evidence', () => {
  assert.equal(verificationStatus(run, [check('test')], 'current'), 'partial')
  assert.equal(verificationStatus(run, [check('test'), check('lint')], 'new'), 'partial')
  assert.equal(
    verificationStatus(run, [check('test', { stale: true }), check('lint')], 'current'),
    'partial',
  )
  assert.equal(verificationStatus(run, [check('test'), check('lint')], 'current'), 'passed')
})
test('uses the latest attempt for each step', () => {
  const attempts = [check('test', { exitCode: 1 }), check('lint'), check('test')]
  assert.equal(verificationStatus(run, attempts, 'current'), 'passed')
  assert.equal(
    verificationStatus(run, [...attempts, check('test', { exitCode: 1 })], 'current'),
    'failed',
  )
  assert.equal(
    verificationStatus(run, [...attempts, check('test', { fingerprint: 'old' })], 'current'),
    'partial',
  )
})
