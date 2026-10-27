import { rpcSchema } from './generated/schema.js'
import type { RpcMethod } from './generated/types.js'
type Schema = Record<string, unknown>
const definitions: Record<string, Schema> = rpcSchema.$defs
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function conforms(value: unknown, rule: Schema): boolean {
  if (typeof rule.$ref === 'string')
    return conforms(value, definitions[rule.$ref.split('/').at(-1)!])
  if (Array.isArray(rule.anyOf)) return rule.anyOf.some((item) => conforms(value, item))
  if (Array.isArray(rule.enum) && !rule.enum.includes(value)) return false
  if (rule.type === 'null') return value === null
  if (rule.type === 'string')
    return (
      typeof value === 'string' &&
      (!rule.minLength || Array.from(value).length >= Number(rule.minLength)) &&
      (!rule.maxLength || Array.from(value).length <= Number(rule.maxLength)) &&
      (rule.pattern === undefined || new RegExp(String(rule.pattern)).test(value))
    )
  if (rule.type === 'boolean') return typeof value === 'boolean'
  if (rule.type === 'number' || rule.type === 'integer')
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (rule.type !== 'integer' || Number.isInteger(value)) &&
      (rule.minimum === undefined || value >= Number(rule.minimum)) &&
      (rule.maximum === undefined || value <= Number(rule.maximum))
    )
  if (rule.type === 'array')
    return (
      Array.isArray(value) &&
      (rule.maxItems === undefined || value.length <= Number(rule.maxItems)) &&
      value.every((item) => conforms(item, record(rule.items) ? rule.items : {}))
    )
  if (rule.type === 'object') {
    if (!record(value)) return false
    const properties = record(rule.properties) ? rule.properties : {}
    if (
      Array.isArray(rule.required) &&
      rule.required.some((key) => typeof key !== 'string' || !(key in value))
    )
      return false
    return Object.entries(value).every(([key, item]) => {
      const field = properties[key]
      if (record(field)) return conforms(item, field)
      return (
        rule.additionalProperties !== false &&
        (!record(rule.additionalProperties) || conforms(item, rule.additionalProperties))
      )
    })
  }
  return true
}
export function rpcMethod(value: string): RpcMethod {
  if (!Object.hasOwn(rpcSchema.methods, value)) throw new Error('UNKNOWN_METHOD')
  return value as RpcMethod
}
export function validateRpc(method: RpcMethod, kind: 'params' | 'result', value: unknown): void {
  if (!conforms(value, rpcSchema.methods[method][kind]))
    throw new Error(kind === 'params' ? 'INVALID_PARAMS' : 'RPC_RESULT_INVALID')
}

export function rpcErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return new RegExp(rpcSchema.errorPattern).exec(message)?.[0] === message ? message : 'HOST_FAILED'
}
