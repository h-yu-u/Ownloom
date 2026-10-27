import { createHash } from 'node:crypto'
import type { Run, Project } from '../domain/types.js'
import type { RunPorts } from './ports.js'

export async function freezeVerificationPlan(ports: RunPorts, run: Run, project: Project) {
  if (!run.verificationCommands?.length || !ports.verificationManifest) return undefined
  const plan = {
    commands: [...run.verificationCommands],
    cwd: project.path,
    manifestDigest: await ports.verificationManifest(project.path),
    repairLimit: run.maxRepairRounds,
    timeoutMs: 20 * 60 * 1000,
    scope: '项目工作区；排除凭据、依赖和构建目录',
  }
  return { ...plan, digest: createHash('sha256').update(JSON.stringify(plan)).digest('hex') }
}
