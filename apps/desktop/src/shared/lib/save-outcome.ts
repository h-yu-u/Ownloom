export type SaveOutcome<T> =
  | { kind: 'saved'; value: T; refreshWarning?: string }
  | {
      kind: 'saved-pending-refresh'
      receipt: { mutationId: string; targetId: string; revision: number }
      message: string
    }
  | { kind: 'invalid'; fields: Readonly<Record<string, string>>; message: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'failed'; message: string; retryable: boolean }
  | { kind: 'uncertain'; mutationId?: string; message: string }
