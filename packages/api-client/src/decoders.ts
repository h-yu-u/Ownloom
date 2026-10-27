import { RuntimeError } from './errors'

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw malformed()
  return value as Record<string, unknown>
}
export function text(value: unknown): string {
  if (typeof value !== 'string') throw malformed()
  return value
}
export function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw malformed()
  return value
}
export function list<T>(value: unknown, decode: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw malformed()
  return value.map(decode)
}
export function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value)
}
export function malformed(): RuntimeError {
  return new RuntimeError('Runtime 响应格式无效', 'RESPONSE_INVALID')
}
