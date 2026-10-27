import type { codingEndpoints } from '@mlx-studio/api-client'
export type CodingGateway = ReturnType<typeof codingEndpoints>
export type {
  CodingProject,
  CodingSession,
  CodingRun,
  CodingSnapshot,
  CodingApproval,
  CodingVerification,
  CodingChange,
  CodingChanges,
  CodingEvent,
  CodingCapability,
} from '@mlx-studio/api-client'
