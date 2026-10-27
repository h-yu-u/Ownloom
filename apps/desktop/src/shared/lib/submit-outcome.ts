export type SubmitOutcome =
  | {
      kind: 'accepted'
      runId: string
      submissionId: string
      targetSessionId: string
      syncWarning?: string
    }
  | { kind: 'blocked'; reason: string }
  | { kind: 'failed'; acceptance: 'not-accepted'; message: string }
  | {
      kind: 'failed'
      acceptance: 'unknown'
      submissionId: string
      targetSessionId: string
      message: string
    }
