import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkModel, providerErrorCode } from '../dist/application/model-result.js'
test('preserve scoped Runtime error codes without exposing response content', () => {
  const message =
    '400: ' + JSON.stringify(JSON.stringify({ code: 'TOOL_XML_INVALID', details: 'private' }))
  assert.equal(providerErrorCode(message), 'TOOL_XML_INVALID')
  assert.equal(providerErrorCode('private arbitrary provider body'), undefined)
  assert.equal(providerErrorCode('Connection error.'), 'MODEL_CONNECTION_FAILED')
  assert.equal(providerErrorCode('Request timed out.'), 'MODEL_REQUEST_TIMEOUT')
  assert.throws(
    () =>
      checkModel({
        lastStopReason: () => 'error',
        lastErrorCode: () => providerErrorCode(message),
      }),
    /TOOL_XML_INVALID/,
  )
  assert.throws(
    () => checkModel({ lastStopReason: () => 'length', lastErrorCode: () => undefined }),
    /MODEL_OUTPUT_TRUNCATED/,
  )
})
