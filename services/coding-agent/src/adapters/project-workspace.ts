import { currentVersion } from './workspace-version.js'
import { mkdtemp, writeFile, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  registerProject,
  read,
  hash,
  safePath,
  Workspace,
  fingerprint,
  files,
  git,
} from './workspace.js'
import type { ProjectPort, RepositoryPort } from '../application/ports.js'
export function projectWorkspace(repo: RepositoryPort): ProjectPort {
  return {
    version: currentVersion,
    register: registerProject,
    fingerprint,
    files,
    git,
    read: async (root, path) => {
      const content = await read(root, path)
      return { content, sha256: hash(content) }
    },
    restore: async (root, change, run) => {
      if (hash(await read(root, change.path)) !== hash(change.after))
        throw new Error('RESTORE_CONFLICT')
      if (change.before === null) await unlink(await safePath(root, change.path))
      else
        await new Workspace(repo, root, run).write(change.path, change.before, hash(change.after))
    },
    createProbe: () => mkdtemp(join(repo.directory, 'probe-')),
    writeProbe: (root) => writeFile(join(root, 'probe.txt'), 'before\n'),
    report: (id, report) =>
      writeFile(join(repo.directory, `probe-report-${id}.json`), JSON.stringify(report, null, 2), {
        mode: 0o600,
      }),
    removeProbe: (root) => rm(root, { recursive: true, force: true }),
  }
}
