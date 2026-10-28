import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const fixtures = [
  ['quoted domain import', { 'apps/desktop/src/modules/a/domain/model.ts': 'import "pinia"' }],
  [
    'cross feature alias in Vue',
    {
      'apps/desktop/src/modules/a/components/Panel.vue':
        '<script setup lang="ts">import type { X } from "@/modules/b/stores/state"</script>',
      'apps/desktop/src/modules/b/stores/state.ts': 'export type X = string',
    },
  ],
  [
    'ESM source cycle',
    {
      'services/coding-agent/src/a.ts': 'export * from "./b.js"',
      'services/coding-agent/src/b.ts': 'import type { A } from "./a.js"; export type A = string',
    },
    /dependency cycle/,
  ],
  [
    'referenced tsconfig alias',
    {
      'services/coding-agent/tsconfig.json': JSON.stringify({
        files: [],
        references: [{ path: './tsconfig.app.json' }],
      }),
      'services/coding-agent/tsconfig.app.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '#app/*': ['src/application/*'] },
        },
        include: ['src/**/*.ts'],
      }),
      'services/coding-agent/src/domain/a.ts': 'import type { B } from "#app/b"',
      'services/coding-agent/src/application/b.ts': 'export type B = string',
    },
    /domain imports/,
  ],
  [
    'unresolved internal reference',
    {
      'services/coding-agent/src/a.ts': 'import "./missing.js"',
    },
    /unresolved internal dependency/,
  ],
  [
    'domain reverse import',
    {
      'services/coding-agent/src/domain/a.ts': 'export * from "../application/b.js"',
      'services/coding-agent/src/application/b.ts': 'export type B = string',
    },
    /domain imports/,
  ],
  [
    'configured alias reverse import',
    {
      'services/coding-agent/tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '#app/*': ['src/application/*'] },
        },
      }),
      'services/coding-agent/src/domain/a.ts': 'import type { B } from "#app/b"',
      'services/coding-agent/src/application/b.ts': 'export type B = string',
    },
    /domain imports/,
  ],
  [
    'unresolved configured alias',
    {
      'services/coding-agent/tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '#app/*': ['src/application/*'] },
        },
      }),
      'services/coding-agent/src/a.ts': 'import type { B } from "#app/missing"',
    },
    /unresolved internal dependency/,
  ],
  [
    'legal ESM type and barrel dependencies',
    {
      'services/coding-agent/src/application/a.ts': 'import type { B } from "../domain/index.js"',
      'services/coding-agent/src/domain/index.ts': 'export type { B } from "./b.js"',
      'services/coding-agent/src/domain/b.ts': 'export type B = string',
    },
    undefined,
    0,
  ],
  [
    'barrel cycle',
    {
      'packages/api-client/src/index.ts': 'export * from "./client"',
      'packages/api-client/src/client.ts': 'export * from "./index"',
    },
  ],
  ['Python sqlite import', { 'services/runtime/src/example/domain/models.py': 'import sqlite3' }],
  [
    'Python adapter import',
    {
      'services/runtime/src/example/application/usecase.py':
        'from example.adapters.worker import Worker',
    },
  ],
  [
    'native import outside platform',
    { 'apps/desktop/src/shared/ui/native.ts': 'import { open } from "@tauri-apps/plugin-dialog"' },
  ],
]
for (const [name, files, diagnostic, status = 1] of fixtures) {
  test(`${status === 0 ? 'accepts' : 'rejects'} ${name}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'mlx-boundaries-'))
    try {
      for (const [path, content] of Object.entries(files)) {
        await mkdir(join(root, path, '..'), { recursive: true })
        await writeFile(join(root, path), content)
      }
      const result = spawnSync(
        process.execPath,
        [fileURLToPath(new URL('./check-boundaries.mjs', import.meta.url)), root],
        { encoding: 'utf8' },
      )
      assert.equal(result.status, status, `${result.stdout}\n${result.stderr}`)
      if (diagnostic) assert.match(result.stderr, diagnostic)
      assert.doesNotMatch(result.stderr, /SyntaxError|MODULE_NOT_FOUND/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}
