import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateRpc, rpcMethod } from '../dist/protocol/validation.js'
const fixtures = JSON.parse(
  readFileSync(new URL('../../../packages/coding-protocol/fixtures.json', import.meta.url)),
)
for (const [index, fixture] of fixtures.entries())
  test(`shared RPC fixture ${index}`, () => {
    const validate = () => validateRpc(rpcMethod(fixture.method), fixture.kind, fixture.value)
    if (fixture.valid) assert.doesNotThrow(validate)
    else assert.throws(validate, /UNKNOWN_METHOD|INVALID_PARAMS|RPC_RESULT_INVALID/)
  })
