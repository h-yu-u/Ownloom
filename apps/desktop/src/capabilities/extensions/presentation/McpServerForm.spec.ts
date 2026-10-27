import { flushPromises, mount } from '@vue/test-utils'
import { NFormItem, NInput, NSelect } from 'naive-ui'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { McpWriteRequest, ExtensionServer } from '@mlx-studio/api-client'
import McpServerForm from './McpServerForm.vue'
import { parsePublicMcpDraft } from './mcp-config'

describe('MCP public configuration and credential form', () => {
  it('imports only supported public fields and rejects secret and native command fields', () => {
    const config = {
      name: 'Docs',
      transport: { type: 'stdio', executable: '/bin/node', cwd: '/tmp' },
    }
    expect(parsePublicMcpDraft(JSON.stringify(config))).toMatchObject({
      enabled: false,
      transport: { args: [], publicEnv: {} },
    })
    for (const invalid of [
      { ...config, secretRefs: { key: 'ref' } },
      { ...config, transport: { ...config.transport, publicEnv: { API_KEY: 'private' } } },
      { ...config, transport: { ...config.transport, args: ['$(command)'] } },
      { ...config, transport: { ...config.transport, command: '!command' } },
    ])
      expect(() => parsePublicMcpDraft(JSON.stringify(invalid))).toThrow()
  })

  it('keeps one mutation and the credential draft across a lost save response', async () => {
    const requests: McpWriteRequest[] = []
    const saveRequest = vi.fn(async (body: McpWriteRequest) => {
      requests.push(body)
      return requests.length > 1
        ? { kind: 'saved' as const, value: { id: 'server' } as ExtensionServer }
        : { kind: 'uncertain' as const, message: '提交结果未知', mutationId: body.mutationId }
    })
    const wrapper = mount(McpServerForm, {
      props: { server: null, pending: false, saveRequest },
    })
    const selects = wrapper.findAllComponents(NSelect)
    selects[1]!.vm.$emit('update:value', 'replace')
    await nextTick()
    const input = (label: string) =>
      wrapper
        .findAllComponents(NFormItem)
        .find((item) => item.props('label') === label)!
        .findComponent(NInput)
    input('服务名称').vm.$emit('update:value', 'Fixture')
    input('可执行文件绝对路径').vm.$emit('update:value', '/bin/node')
    input('工作目录绝对路径').vm.$emit('update:value', '/tmp')
    input('一次性凭据值').vm.$emit('update:value', 'private-fixture')
    await nextTick()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(requests).toHaveLength(2)
    expect(requests[0]!.mutationId).toBe(requests[1]!.mutationId)
    expect(requests[1]!.credential).toEqual({
      action: 'replace',
      field: 'API_KEY',
      kind: 'env',
      value: 'private-fixture',
    })
    expect(input('一次性凭据值').props('value')).toBe('')
    wrapper.unmount()
  })
})

it('retains unsaved fields in process memory after closing and recreating the form', async () => {
  const memory = new Map(),
    saveRequest = vi.fn()
  const first = mount(McpServerForm, {
    props: { server: null, pending: false, memory, saveRequest },
  })
  const name = first
    .findAllComponents(NFormItem)
    .find((item) => item.props('label') === '服务名称')!
    .getComponent(NInput)
  name.vm.$emit('update:value', 'Keep draft')
  await nextTick()
  first.unmount()
  const reopened = mount(McpServerForm, {
    props: { server: null, pending: false, memory, saveRequest },
  })
  expect(
    reopened
      .findAllComponents(NFormItem)
      .find((item) => item.props('label') === '服务名称')!
      .getComponent(NInput)
      .props('value'),
  ).toBe('Keep draft')
  reopened.unmount()
})
