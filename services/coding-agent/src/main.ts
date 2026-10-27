import { rpcSchema } from './protocol/generated/schema.js'
import { rpcMethod, validateRpc, rpcErrorCode } from './protocol/validation.js'
import type { RpcParamsMap } from './protocol/generated/types.js'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { Repository } from './adapters/repository.js'
import { createCodingService } from './composition-root.js'
import { object, string } from './domain/types.js'
const directory = process.argv[2]
if (!directory) throw new Error('CODING_DATA_DIRECTORY_REQUIRED')
process.env.PI_CODING_AGENT_DIR = `${directory}/pi`
const repo = new Repository(directory),
  epoch = randomUUID()
const service = createCodingService(repo, (pid, state) => {
  process.stdout.write(
    JSON.stringify({
      protocolVersion: rpcSchema.protocolVersion,
      hostEpoch: epoch,
      type: 'command.process',
      pid,
      state,
    }) + '\n',
  )
})
const send = (value: unknown): void => {
  process.stdout.write(JSON.stringify(value) + '\n')
}
send({
  protocolVersion: rpcSchema.protocolVersion,
  type: 'host.ready',
  hostEpoch: epoch,
  piVersion: '1.2.0',
})
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
let closing = false
async function handle(line: string): Promise<void> {
  let requestId: string | null = null
  try {
    if (line.length > 1024 * 1024) throw new Error('FRAME_TOO_LARGE')
    const frame = object(JSON.parse(line) as unknown)
    requestId = string(frame.requestId)
    if (frame.protocolVersion !== rpcSchema.protocolVersion || frame.hostEpoch !== epoch)
      throw new Error('PROTOCOL_MISMATCH')
    if (closing) throw new Error('HOST_SHUTTING_DOWN')
    const method = rpcMethod(string(frame.method))
    validateRpc(method, 'params', frame.params)
    if (method === 'shutdown') closing = true
    const result = await service.dispatch(method, frame.params as RpcParamsMap[typeof method])
    send({ protocolVersion: rpcSchema.protocolVersion, hostEpoch: epoch, requestId, result })
    if (method === 'shutdown') input.close()
  } catch (error) {
    send({
      protocolVersion: rpcSchema.protocolVersion,
      hostEpoch: epoch,
      requestId,
      error: rpcErrorCode(error),
    })
  }
}
input.on('line', (line) => {
  void handle(line)
})
input.on('close', () => {
  closing = true
  void service.close().finally(() => {
    repo.close()
    process.exit(0)
  })
})
process.on('SIGTERM', () => input.close())
process.on('SIGINT', () => input.close())
