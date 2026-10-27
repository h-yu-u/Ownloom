/** A single execute boundary accounts for every accepted call, including failures. */
export class ToolGateway {
  private seen = new Set<string>()
  private calls = 0
  constructor(
    private input: {
      check(): void
      started(id: string, name: string): void
      finished(id: string, name: string, error: string | null): void
    },
  ) {}
  async invoke<T>(id: string, name: string, execute: () => Promise<T>): Promise<T> {
    this.input.check()
    if (this.seen.has(id)) throw new Error('DUPLICATE_TOOL_ID')
    this.seen.add(id)
    if (++this.calls > 48) throw new Error('TOOL_BUDGET_EXCEEDED')
    this.input.started(id, name)
    let code: string | null = null
    try {
      return await execute()
    } catch (error) {
      code =
        error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
          ? error.message
          : 'TOOL_FAILED'
      throw error
    } finally {
      this.input.finished(id, name, code)
    }
  }
}
