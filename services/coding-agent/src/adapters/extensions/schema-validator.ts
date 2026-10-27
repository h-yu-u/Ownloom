import { Ajv, type ValidateFunction } from 'ajv'
import { createHash } from 'node:crypto'
import type { Tool as McpTool } from '@earendil-works/pi-mcp'
import type { Server, Tool } from '../../extensions/domain/types.js'
import { digest } from './skill-files.js'
const validator = new Ajv({
  strict: true,
  allErrors: false,
  validateFormats: true,
  addUsedSchema: false,
})
export function compileSchema(schema: Record<string, unknown>): ValidateFunction {
  if (JSON.stringify(schema).length > 16384) throw new Error('MCP_SCHEMA_UNSUPPORTED')
  try {
    return validator.compile(schema)
  } catch {
    throw new Error('MCP_SCHEMA_UNSUPPORTED')
  }
}
function modelName(server: string, tool: string, collision = false): string {
  const name = `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, '_')
  if (name.length <= 64 && !collision) return name
  const hash = createHash('sha256').update(`${server}\0${tool}`).digest('hex').slice(0, 8)
  return `${name.slice(0, 55)}_${hash}`
}
export function inventoryTools(server: Server, offered: McpTool[]): Tool[] {
  if (offered.length > 128 || new Set(offered.map((tool) => tool.name)).size !== offered.length)
    throw new Error('MCP_INVENTORY_TOO_LARGE')
  const plain = offered.map((tool) => modelName(server.id, tool.name))
  return offered.map((tool, index) => {
    if ((tool.description?.length ?? 0) > 4096 || tool.name.length > 256)
      throw new Error('MCP_SCHEMA_UNSUPPORTED')
    const inputSchema = {
      ...tool.inputSchema,
      type: tool.inputSchema.type ?? 'object',
      properties: tool.inputSchema.properties ?? {},
    }
    compileSchema(inputSchema)
    const name = modelName(
      server.id,
      tool.name,
      plain.indexOf(plain[index]) !== plain.lastIndexOf(plain[index]),
    )
    if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) throw new Error('TOOL_NAME_UNSUPPORTED')
    return {
      id: `${server.id}:${tool.name}`,
      serverId: server.id,
      originalName: tool.name,
      modelName: name,
      schemaDigest: digest(inputSchema),
      inputSchema,
      description: (tool.description ?? tool.name).slice(0, 4096),
      risk: server.readOnlyTools.includes(tool.name) ? 'read' : 'ask',
    }
  })
}
