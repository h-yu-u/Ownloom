import { randomUUID } from 'node:crypto'
import type { Provider, ProjectPort } from './ports.js'
import type { CapabilityRepository } from './repository-ports.js'
import type { Capability } from '../domain/types.js'
import type { Runs } from './runs.js'
export class CapabilityVerifier {
  constructor(
    private repo: CapabilityRepository,
    private runs: Runs,
    private projects: ProjectPort,
    private checkAdmission: () => void,
  ) {}
  private async prepareProbe() {
    const directory = await this.projects.createProbe()
    const project = this.repo.save('project', {
      ...(await this.projects.register(directory)),
      commands: ["/usr/bin/grep -qx 'after' probe.txt"],
    })
    await this.projects.writeProbe(directory)
    const session = this.repo.save('session', {
      id: randomUUID(),
      projectId: project.id,
      title: '工具协议验证',
      pinned: false,
      archived: false,
      piPath: null,
    })
    return { directory, project, session }
  }
  async verify(provider: Provider): Promise<Capability> {
    this.checkAdmission()
    if (this.repo.active()) throw new Error('CODING_BUSY')
    const { directory, project, session } = await this.prepareProbe()
    let runId: string | undefined
    try {
      const run = await this.runs.submit({
        sessionId: session.id,
        submissionId: randomUUID(),
        text: "Coding capability probe: first request both list and read probe.txt in a single response, then replace its entire content with after followed by a newline using the returned hash, run exactly /usr/bin/grep -qx 'after' probe.txt. If a check fails read the file and repair it, then run the same check. Do not change any other files. Finish with a short summary.",
        mode: 'develop',
        provider,
        probe: true,
      })
      runId = run.id
      await this.runs.wait(run.id)
      const final = this.repo.get('run', run.id),
        events = this.repo.events(0, session.id)
      const passed =
        final.status === 'completed' &&
        final.verification === 'passed' &&
        (await this.projects.read(directory, 'probe.txt')).content.trimEnd() === 'after' &&
        events.some((event) => event.type === 'tool.started' && event.text === 'read') &&
        this.repo.changesForRun(run.id).some((change) => change.state === 'written')
      const result: Capability = {
        id: provider.modelId,
        status: passed ? 'verified' : 'unverified',
        verifiedAt: passed ? new Date().toISOString() : null,
        engineVersion: provider.engineVersion,
        modelFingerprint: provider.fingerprint,
        parserVersion: 'mlx-tools-v2',
        detail: passed
          ? '已验证 Pi → MLX 结构化推理 → read/write → 命令退出码 → 多轮工具结果。'
          : `工具闭环未通过：${final.error ?? final.verification}`,
      }
      await this.projects.report(session.id, {
        capability: result,
        run: final,
        events,
        verifications: this.repo.checksForRun(run.id),
      })
      return this.repo.save('capability', result)
    } finally {
      if (!runId || !this.runs.owns(runId)) {
        this.repo.deleteSession(session.id)
        this.repo.delete('project', project.id)
        await this.projects.removeProbe(directory)
      }
    }
  }
}
