import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { object } from '../../domain/types.js'
import type { ActiveCapability, ToolContext } from '../../application/ports.js'
import type { Snapshot } from '../../extensions/domain/types.js'
import type { RunExtensions } from '../../extensions/application/ports.js'
import { compileSchema } from './schema-validator.js'
import { capabilityRequest } from './capability-client.js'
export function builtinDefinitions(
  snapshot: Snapshot,
  capability: ActiveCapability,
  context: ToolContext,
  extensions: RunExtensions,
): ToolDefinition[] {
  return snapshot.tools
    .filter((tool) => tool.serverId === 'builtin')
    .map((tool) => {
      const validate = compileSchema(tool.inputSchema)
      return {
        name: tool.modelName,
        label: tool.modelName,
        description: tool.description,
        parameters: tool.inputSchema,
        executionMode: 'sequential',
        execute: (id, raw, signal) =>
          context.invoke(id, tool.modelName, async () => {
            extensions.check(snapshot)
            const args = structuredClone(object(raw))
            if (!validate(args)) throw new Error('CAPABILITY_INPUT_INVALID')
            await context.authorizeTool(id, tool, args, signal)
            extensions.check(snapshot)
            const result = await capabilityRequest(
              capability,
              capability.token,
              `/tools/${encodeURIComponent(id)}`,
              { action: tool.originalName, args },
              signal,
            )
            return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result }
          }),
      }
    })
}
