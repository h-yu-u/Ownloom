import Type from 'typebox'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { relative } from 'node:path'
import { files, read, hash, git, safePath } from './workspace.js'
import { object } from '../domain/types.js'
import type { ToolContext } from '../application/ports.js'
import { queryProgress, type QueryProgress } from '../domain/query-progress.js'
const pathSchema = Type.Object(
  { path: Type.String({ maxLength: 4096 }) },
  { additionalProperties: false },
)
export function tools(context: ToolContext): ToolDefinition[] {
  let progress: QueryProgress | undefined
  function tool(
    name: string,
    description: string,
    parameters: ToolDefinition['parameters'],
    execute: (
      id: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
    ) => Promise<unknown>,
  ): ToolDefinition {
    return {
      name,
      label: name,
      description,
      parameters,
      executionMode: 'sequential',
      execute: async (id, params, signal) => {
        if (signal?.aborted) throw new Error('CANCELLED')
        return context.invoke(id, name, async () => {
          const result = await execute(id, object(params), signal)
          return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
        })
      },
    }
  }
  const selected = [
    tool(
      'read',
      'Read a UTF-8 file. Returns content and sha256; pass sha256 to write/edit.',
      pathSchema,
      async (_id, params) => {
        const content = await read(context.root, String(params.path))
        return { content, sha256: hash(content) }
      },
    ),
    tool(
      'list',
      'List up to 2000 files within the project, excluding private/generated paths.',
      Type.Object({}, { additionalProperties: false }),
      async () => ({ files: await files(context.root), truncatedAt: 2000 }),
    ),
    tool(
      'search',
      'Find literal text in files; at most 100 matches, skipped binary/large files.',
      Type.Object(
        { query: Type.String({ minLength: 1, maxLength: 200 }) },
        { additionalProperties: false },
      ),
      async (_id, params) => {
        const matches: { path: string; line: number; text: string }[] = []
        for (const path of await files(context.root)) {
          if (matches.length >= 100) break
          let content: string
          try {
            content = await read(context.root, path)
          } catch (error) {
            if (
              error instanceof Error &&
              /FILE_TOO_LARGE_OR_NOT_TEXT|BINARY_FILE_REJECTED/.test(error.message)
            )
              continue
            throw error
          }
          for (const [index, line] of content.split('\n').entries())
            if (line.includes(String(params.query)) && matches.length < 100)
              matches.push({ path, line: index + 1, text: line.slice(0, 1000) })
        }
        return { matches, truncatedAt: 100 }
      },
    ),
    tool(
      'git_status',
      'Query Git status without running hooks.',
      Type.Object({}, { additionalProperties: false }),
      async () => ({ status: await git(context.root, 'status') }),
    ),
  ]
  if (context.mode === 'develop') {
    selected.push(
      tool(
        'write',
        'Create or replace a file. Omit expectedHash (or pass null) only for a new file. Replacing an existing file requires the sha256 returned by read.',
        Type.Object(
          {
            path: Type.String(),
            content: Type.String({ maxLength: 524288 }),
            expectedHash: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          },
          { additionalProperties: false },
        ),
        async (_id, params) => {
          const expected =
            params.expectedHash === undefined || params.expectedHash === null
              ? null
              : String(params.expectedHash)
          const path = relative(
            context.root,
            await safePath(context.root, String(params.path), true),
          )
          await context.authorizeWrite(_id, path, String(params.content), expected)
          const result = await context.workspace.write(path, String(params.content), expected)
          context.changed(path)
          progress = undefined
          return { sha256: result }
        },
      ),
    )
    selected.push(
      tool(
        'edit',
        'Replace a unique literal substring in a previously read file.',
        Type.Object(
          {
            path: Type.String(),
            oldText: Type.String({ minLength: 1 }),
            newText: Type.String(),
            expectedHash: Type.String(),
          },
          { additionalProperties: false },
        ),
        async (_id, params) => {
          const path = relative(context.root, await safePath(context.root, String(params.path))),
            oldText = String(params.oldText),
            content = await read(context.root, path)
          if (content.split(oldText).length !== 2) throw new Error('EDIT_NOT_UNIQUE')
          await context.authorizeWrite(
            _id,
            path,
            content.replace(oldText, () => String(params.newText)),
            String(params.expectedHash),
          )
          const result = await context.workspace.write(
            path,
            content.replace(oldText, () => String(params.newText)),
            String(params.expectedHash),
          )
          context.changed(path)
          progress = undefined
          return { sha256: result }
        },
      ),
    )
    selected.push(
      tool(
        'run_command',
        'Run a non-interactive command (120-second limit) under the selected access policy; the runtime asks approval when required. Prefer build/test checks to background development servers. Never use git commit/push/reset/clean or broad process-name termination.',
        Type.Object(
          { command: Type.String({ minLength: 1, maxLength: 4096 }) },
          { additionalProperties: false },
        ),
        async (id, params, signal) => {
          const command = String(params.command)
          const result = await context.command(id, command, signal)
          const next = queryProgress(progress, command, result)
          progress = next.state
          return next.notice ? { ...object(result), progressNotice: next.notice } : result
        },
      ),
    )
  }
  return selected
}
