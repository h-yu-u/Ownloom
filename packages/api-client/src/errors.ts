export class RuntimeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 0,
    readonly retryable = false,
    readonly requestId?: string,
    readonly phase?: string,
    readonly recoveryActions: string[] = [],
  ) {
    super(message)
    this.name = 'RuntimeError'
  }
}

export function decodeError(value: unknown, status: number): RuntimeError {
  const fields = typeof value === 'object' && value !== null ? Reflect.get(value, 'error') : null
  const field = (key: string): unknown =>
    typeof fields === 'object' && fields !== null ? Reflect.get(fields, key) : undefined
  return new RuntimeError(
    typeof field('message') === 'string'
      ? String(field('message'))
      : `Runtime 请求失败 (${status})`,
    typeof field('code') === 'string' ? String(field('code')) : 'REQUEST_FAILED',
    status,
    field('retryable') === true,
    typeof field('request_id') === 'string' ? String(field('request_id')) : undefined,
    typeof field('phase') === 'string' ? String(field('phase')) : undefined,
    Array.isArray(field('recoveryActions'))
      ? (field('recoveryActions') as unknown[]).filter(
          (item): item is string => typeof item === 'string',
        )
      : [],
  )
}
