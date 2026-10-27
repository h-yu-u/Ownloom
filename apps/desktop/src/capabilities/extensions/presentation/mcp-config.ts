import type { McpWriteRequest } from '@mlx-studio/api-client'
export type PublicMcpDraft = Pick<
  McpWriteRequest,
  'name' | 'enabled' | 'transport' | 'allowedTools' | 'readOnlyTools'
>
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置必须是对象')
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('JSON 包含不支持的字段；秘密请在独立凭据栏填写')
  return Object.fromEntries(Object.entries(value))
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('配置字符串无效')
  return value
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('配置数组无效')
  return value.map(text)
}
function publicValues(value: unknown): Record<string, string> {
  const values = object(value, Object.keys(value ?? {}))
  if (
    Object.keys(values).some((key) => /authorization|cookie|key|token|secret|password/i.test(key))
  )
    throw new Error('秘密请在独立凭据栏填写')
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, text(value)]))
}
/** Only product public configuration is imported; native Pi commands and secrets are excluded. */
export function parsePublicMcpDraft(source: string): PublicMcpDraft {
  if (source.length > 65536 || /!command|\$\{|\$\(|`/.test(source))
    throw new Error('配置过大或包含不支持的命令替换')
  const draft = object(JSON.parse(source), [
    'name',
    'enabled',
    'transport',
    'allowedTools',
    'readOnlyTools',
  ])
  const config = object(draft.transport, [
    'type',
    'executable',
    'args',
    'cwd',
    'publicEnv',
    'url',
    'publicHeaders',
    'authMode',
  ])
  let transport: McpWriteRequest['transport']
  if (config.type === 'stdio') {
    object(config, ['type', 'executable', 'args', 'cwd', 'publicEnv'])
    transport = {
      type: 'stdio',
      executable: text(config.executable),
      args: strings(config.args ?? []),
      cwd: text(config.cwd),
      publicEnv: publicValues(config.publicEnv ?? {}),
    }
  } else if (config.type === 'streamable-http') {
    object(config, ['type', 'url', 'publicHeaders', 'authMode'])
    if (config.authMode && config.authMode !== 'none') throw new Error('认证请在独立凭据栏配置')
    transport = {
      type: 'streamable-http',
      url: text(config.url),
      publicHeaders: publicValues(config.publicHeaders ?? {}),
      authMode: 'none',
    }
  } else throw new Error('不支持的连接方式')
  if (draft.enabled !== undefined && typeof draft.enabled !== 'boolean')
    throw new Error('启用状态无效')
  return {
    name: text(draft.name),
    enabled: draft.enabled ?? false,
    transport,
    allowedTools: strings(draft.allowedTools ?? []),
    readOnlyTools: strings(draft.readOnlyTools ?? []),
  }
}
