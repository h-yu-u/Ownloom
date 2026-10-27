import Type from 'typebox'
import { object } from '../../domain/types.js'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { RunExtensions } from '../../extensions/application/ports.js'
import type { ToolContext } from '../../application/ports.js'
import type { Snapshot } from '../../extensions/domain/types.js'
export function skillTool(
  snapshot: Snapshot,
  extensions: RunExtensions,
  context: ToolContext,
): ToolDefinition {
  return {
    name: 'read_skill',
    label: 'read_skill',
    description:
      'Read a selected, pinned Skill body or UTF-8 reference. Scripts are readable only; execution is not supported.',
    parameters: Type.Object(
      {
        skillId: Type.String(),
        revision: Type.Integer({ minimum: 1 }),
        relativePath: Type.String({ maxLength: 4096 }),
      },
      { additionalProperties: false },
    ),
    executionMode: 'sequential',
    execute: (id, raw) =>
      context.invoke(id, 'read_skill', async () => {
        const args = object(raw)
        extensions.check(snapshot)
        const skill = snapshot.skills.find(
          (item) => item.id === args.skillId && item.revision === args.revision,
        )
        if (!skill) throw new Error('SKILL_NOT_ALLOWED')
        const text = await extensions.read(skill, String(args.relativePath))
        if (Buffer.byteLength(text) > 12288) throw new Error('EXTENSION_CONTEXT_BUDGET_EXCEEDED')
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                skillId: skill.id,
                revision: skill.revision,
                path: args.relativePath,
                text,
              }),
            },
          ],
          details: {},
        }
      }),
  }
}
