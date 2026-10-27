export interface Transport {
  get(path: string, signal?: AbortSignal): Promise<unknown>
  post(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown>
  patch(path: string, body: unknown): Promise<unknown>
  put(path: string, body: unknown): Promise<unknown>
  delete(path: string): Promise<unknown>
}
