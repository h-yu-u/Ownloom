import type { RepositoryPort } from './ports.js'

/** Use-case capabilities; the concrete repository remains the single database owner. */
export type TaskRepository = Pick<RepositoryPort, 'recentRuns' | 'find'>
export type SnapshotRepository = Pick<
  RepositoryPort,
  | 'get'
  | 'active'
  | 'listChecks'
  | 'listRuns'
  | 'checksForRun'
  | 'listApprovals'
  | 'historyEvents'
  | 'watermark'
>
export type ProjectSessionsRepository = SnapshotRepository &
  Pick<
    RepositoryPort,
    'list' | 'findProject' | 'save' | 'listSessions' | 'delete' | 'deleteSession'
  >
export type ChangeRepository = Pick<
  RepositoryPort,
  'get' | 'active' | 'changeHeaders' | 'changeDetail' | 'save'
>
export type RunStateRepository = Pick<RepositoryPort, 'get' | 'save'>
export type ApprovalRepository = RunStateRepository & Pick<RepositoryPort, 'pendingApprovals'>
export type RunEventRepository = Pick<RepositoryPort, 'get' | 'append'>
export type TranscriptRepository = RunStateRepository & Pick<RepositoryPort, 'append'>
export type InstructionRepository = Pick<RepositoryPort, 'find' | 'save' | 'append'>
export type VerificationRepository = Pick<RepositoryPort, 'get' | 'checksForRun'>
export type CommandRepository = TranscriptRepository & VerificationRepository
export type PreparationRepository = InstructionRepository &
  RunEventRepository &
  Pick<RepositoryPort, 'directory'>
export type RunRepository = ApprovalRepository &
  CommandRepository &
  PreparationRepository &
  Pick<RepositoryPort, 'findSubmission' | 'startRun' | 'list'>
export type AgentQueryRepository = TaskRepository &
  Pick<
    RepositoryPort,
    | 'get'
    | 'list'
    | 'listRuns'
    | 'listApprovals'
    | 'events'
    | 'watermark'
    | 'findSubmission'
    | 'waitEvents'
    | 'historyEvents'
  >
export type AgentRepository = AgentQueryRepository &
  ApprovalRepository &
  TranscriptRepository &
  Pick<RepositoryPort, 'directory'>
export type CapabilityRepository = Pick<
  RepositoryPort,
  | 'get'
  | 'save'
  | 'active'
  | 'events'
  | 'changesForRun'
  | 'checksForRun'
  | 'deleteSession'
  | 'delete'
>
export type ServiceRepository = TaskRepository &
  Pick<
    RepositoryPort,
    'get' | 'save' | 'active' | 'list' | 'findSubmission' | 'events' | 'waitEvents' | 'watermark'
  >
