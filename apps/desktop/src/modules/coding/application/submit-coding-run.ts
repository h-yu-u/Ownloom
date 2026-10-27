import type { ExtensionSelection } from '@mlx-studio/api-client'
import { RuntimeError } from '@mlx-studio/api-client'
import type { CodingRun, CodingGateway } from './ports'
import type { CodingMode, CodingPermissionMode } from '../domain/status'

export function modelNeedsVerification(cause: unknown): boolean {
  return cause instanceof RuntimeError && cause.code === 'MODEL_TOOLS_UNVERIFIED'
}
interface Submission {
  sessionId: string
  modelId: string
  text: string
  mode: CodingMode
  permissionMode?: CodingPermissionMode
  queue: boolean
  verifyAfter?: boolean
  selection?: ExtensionSelection
}
interface Dependencies {
  gateway: Pick<CodingGateway, 'submit'>
  ensure(modelId: string, force?: boolean): Promise<void>
  invalidate(modelId: string): void
  createId(): string
}
export async function submitCodingRun(input: Submission, deps: Dependencies): Promise<CodingRun> {
  await deps.ensure(input.modelId)
  const { sessionId, ...fields } = input
  const request = {
    ...fields,
    verifyAfter: fields.verifyAfter ?? false,
    permissionMode: fields.permissionMode ?? 'ask',
    submissionId: deps.createId(),
  }
  try {
    return await deps.gateway.submit(sessionId, request)
  } catch (cause) {
    if (!modelNeedsVerification(cause)) throw cause
    deps.invalidate(input.modelId)
    await deps.ensure(input.modelId, true)
    return await deps.gateway.submit(sessionId, request)
  }
}
