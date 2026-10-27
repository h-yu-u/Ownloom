import type { Provider, RunRuntime } from './ports.js'
import type { Mode, PermissionMode, Session } from '../domain/types.js'
import { sessionWithInputTitle } from '../domain/session-title.js'
import type { Selection } from '../extensions/domain/types.js'
import type { RpcParamsMap } from '../protocol/generated/types.js'
export interface Submission {
  permissionMode?: PermissionMode
  sessionId: string
  submissionId: string
  text: string
  mode: Mode
  provider: Provider
  probe?: boolean
  queue?: boolean
  verifyOnly?: boolean
  verifyAfter?: boolean
  selection?: Selection
  runtime?: RunRuntime
  connectionSecrets?: RpcParamsMap['runs.submit']['connectionSecrets']
}
export function submittedSession(session: Session, input: Submission): Session {
  return input.probe || input.verifyOnly ? session : sessionWithInputTitle(session, input.text)
}
