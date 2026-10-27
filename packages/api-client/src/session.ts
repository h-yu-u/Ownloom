import { RuntimeClient } from './transport/client'
import type { RuntimeConnection } from './types'

export type SessionStatus = 'starting' | 'ready' | 'failed'
export class RuntimeSession {
  private epoch = 0
  private client?: RuntimeClient
  private connecting?: Promise<RuntimeClient>
  connection?: RuntimeConnection

  constructor(
    private readonly connect: () => Promise<RuntimeConnection>,
    private readonly changed: (status: SessionStatus, message: string | null) => void,
  ) {}

  get(): Promise<RuntimeClient> {
    if (this.client) return Promise.resolve(this.client)
    if (this.connecting) return this.connecting
    const epoch = this.epoch
    const task = this.open(epoch)
    this.connecting = task
    void task
      .finally(() => {
        if (this.connecting === task) this.connecting = undefined
      })
      .catch(() => undefined)
    return task
  }

  invalidate(message: string | null, status: SessionStatus = 'failed'): void {
    this.epoch += 1
    this.client = undefined
    this.connecting = undefined
    this.connection = undefined
    this.changed(status, message)
  }

  private async open(epoch: number): Promise<RuntimeClient> {
    this.changed('starting', null)
    try {
      const connection = await this.connect()
      if (epoch !== this.epoch) throw new Error('Runtime 连接已被替换')
      if (connection.protocolVersion !== 1)
        throw new Error(`Runtime 协议版本不兼容：${connection.protocolVersion}`)
      const client = new RuntimeClient(connection, {
        onConnectionInvalid: () => {
          if (this.client === client && epoch === this.epoch) this.invalidate('Runtime 连接已失效')
        },
      })
      this.connection = connection
      this.client = client
      this.changed('ready', null)
      return client
    } catch (cause) {
      if (epoch === this.epoch)
        this.invalidate(cause instanceof Error ? cause.message : 'Runtime 连接失败')
      throw cause
    }
  }
}
