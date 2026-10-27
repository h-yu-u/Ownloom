export interface RuntimeConnection {
  baseUrl: string
  token: string
  protocolVersion: number
  generation?: number
}

export interface RuntimeEvent {
  seq: number
  type: string
  payload: Record<string, unknown>
}
