import type { PiSession, RepositoryPort } from './ports.js'

type Opened = { session: PiSession; path(): string | undefined }
interface Input {
  repo: RepositoryPort
  kind: 'session' | 'agentSession'
  sessionId: string
  runId: string
  opened: Opened
}

export async function saveTranscript(input: Input): Promise<void> {
  const { repo, kind, sessionId, opened } = input
  repo.save(kind, {
    ...repo.get(kind, sessionId),
    piPath: opened.path() ?? null,
    transcript: await opened.session.checkpoint?.(),
  })
}

export async function closeTranscript(input: Input): Promise<void> {
  try {
    await saveTranscript(input)
  } catch {
    input.repo.append(
      input.sessionId,
      input.runId,
      'transcript.checkpoint_failed',
      'TRANSCRIPT_CHECKPOINT_FAILED',
    )
  } finally {
    await input.opened.session.close()
  }
}
