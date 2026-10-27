import type { Tool } from './types.js'
const imageSchema = {
  type: 'object',
  properties: {
    prompt: { type: 'string', minLength: 1, maxLength: 10000 },
    width: { type: 'integer', minimum: 64, maximum: 2048, multipleOf: 16 },
    height: { type: 'integer', minimum: 64, maximum: 2048, multipleOf: 16 },
    steps: { type: 'integer', minimum: 1, maximum: 100 },
    seed: { type: 'integer', minimum: 0, maximum: 4294967295 },
    strength: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
  },
  required: ['prompt'],
  additionalProperties: false,
}
const speechSchema = {
  type: 'object',
  properties: {
    text: { type: 'string', minLength: 1, maxLength: 2000 },
    language: {
      type: 'string',
      enum: ['auto', 'zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'],
    },
  },
  required: ['text'],
  additionalProperties: false,
}
export function builtinTools(digest: (value: unknown) => string): Tool[] {
  return [
    {
      name: 'image_generate',
      schema: imageSchema,
      description:
        'Generate a local image with the user-selected model. Waits for a saved image artifact. Returns an artifact reference, not visual input.',
    },
    {
      name: 'speech_generate',
      schema: speechSchema,
      description:
        'Synthesize local speech with the user-selected model and approved preset or managed voice. Waits for a saved audio artifact.',
    },
  ].map((tool) => ({
    id: `builtin:${tool.name}`,
    serverId: 'builtin',
    originalName: tool.name,
    modelName: tool.name,
    schemaDigest: digest(tool.schema),
    inputSchema: tool.schema,
    description: tool.description,
    risk: 'ask',
  }))
}
