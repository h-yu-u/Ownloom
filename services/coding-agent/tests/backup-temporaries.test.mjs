import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { exportData } from '../dist/adapters/data-export.js'

test('failed owner export removes its partial database snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ownloom-partial-backup-'))
  try {
    const repo = {
      directory,
      exportDatabase: () => {
        throw new Error('SNAPSHOT_FAILED')
      },
    }
    await assert.rejects(exportData(repo, {}, {}), /SNAPSHOT_FAILED/)
    assert.deepEqual(await readdir(join(directory, 'exports')), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
