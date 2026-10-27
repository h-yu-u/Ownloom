import { createInterface } from 'node:readline'
const tools = [
  {
    name: 'lookup',
    description: 'Look up a document',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  { name: 'a-b', inputSchema: { type: 'object' } },
  { name: 'a_b', inputSchema: { type: 'object' } },
]
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize')
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1' },
      },
    })
  if (message.method === 'tools/list') send({ jsonrpc: '2.0', id: message.id, result: { tools } })
  if (message.method === 'tools/call') {
    send({
      jsonrpc: '2.0',
      method: 'notifications/message',
      params: { data: process.env.SECRET ?? 'private-log' },
    })
    const query = message.params.arguments.query
    if (query === 'disconnect') process.exit(0)
    const content =
      query === 'media'
        ? [{ type: 'image', data: 'abc', mimeType: 'image/png' }]
        : [
            {
              type: 'text',
              text:
                query === 'large'
                  ? 'x'.repeat(24000)
                  : query === 'secret'
                    ? (process.env.SECRET ?? 'none')
                    : `found ${query}`,
            },
          ]
    send({ jsonrpc: '2.0', id: message.id, result: { content, isError: query === 'error' } })
  }
})
