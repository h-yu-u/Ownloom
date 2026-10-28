import { node, pnpm, python, task } from './commands.mjs'

export const checkRpc = python('scripts.generate.generate_coding_rpc', '--check')

export const contractTasks = {
  'generate:api': task('Generate API types from the Runtime OpenAPI schema.', [
    pnpm('--filter', '@mlx-studio/api-client', 'generate'),
  ]),
  'generate:rpc': task('Generate Python and TypeScript Coding RPC contracts.', [
    python('scripts.generate.generate_coding_rpc'),
  ]),
  'generate:tokens': task('Generate CSS and TypeScript design tokens.', [
    node('scripts/generate/generate-design-tokens.mjs'),
  ]),
  'check:tokens': task('Check generated design tokens for drift.', [
    node('scripts/generate/generate-design-tokens.mjs', '--check'),
  ]),
}
