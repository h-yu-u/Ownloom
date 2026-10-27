import type { McpFetch } from '@earendil-works/pi-mcp'
/** No redirects, OAuth refresh or POST replay; bound both headers and streamed bytes. */
export function boundedFetch(target: string, check: () => void): McpFetch {
  return async (input, init) => {
    check()
    if (new URL(String(input)).href !== new URL(target).href) throw new Error('MCP_URL_NOT_ALLOWED')
    const signal = AbortSignal.any([
      ...(init?.signal ? [init.signal] : []),
      AbortSignal.timeout(15000),
    ])
    const response = await fetch(input, { ...init, signal, redirect: 'error' })
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      throw new Error(response.status === 401 ? 'MCP_AUTH_REQUIRED' : 'MCP_PERMISSION_DENIED')
    }
    if (
      response.status === 404 &&
      typeof init?.body === 'string' &&
      init.body.includes('"tools/call"')
    ) {
      await response.body?.cancel()
      throw new Error('MCP_RESULT_UNKNOWN')
    }
    if (!response.body) return response
    const reader = response.body.getReader()
    let bytes = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read()
          if (next.done) {
            controller.close()
            return
          }
          bytes += next.value.length
          if (bytes > 1024 * 1024) throw new Error('MCP_RESPONSE_TOO_LARGE')
          controller.enqueue(next.value)
        } catch (error) {
          await reader.cancel()
          controller.error(error)
        }
      },
      cancel: () => reader.cancel(),
    })
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
}
