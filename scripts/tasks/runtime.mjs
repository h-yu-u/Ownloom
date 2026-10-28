import { command, python, task, uv } from './commands.mjs'
import { buildCoding } from './coding.mjs'

// Directory scopes include new scripts automatically; each owner supplies its Ruff settings.
export const pythonSources = ['services/runtime/src', 'tests', 'scripts']
export const buildRuntime = command('bash', 'scripts/build/build-runtime.sh')

const verification = {
  chat: ['Check local text chat.', 'verify_local_chat'],
  vision: ['Check local vision with an explicit image.', 'verify_local_vision'],
  image: ['Check local image generation.', 'verify_local_image'],
  edit: ['Check image editing with explicit fixtures.', 'verify_local_edit'],
  speech: ['Check speech generation and cloning.', 'verify_local_speech'],
  'speech-quality': ['Collect packaged speech quality evidence.', 'verify_speech_quality'],
  coding: ['Exercise an isolated Coding workspace.', 'verify_local_coding'],
  streaming: ['Check real-model chat streaming.', 'verify_chat_streaming'],
  system: ['Report local system capabilities.', 'system_probe'],
}

export const runtimeTasks = {
  'check:runtime': task('Run Python Ruff and strict Runtime type checks.', [
    uv('ruff', 'check', ...pythonSources),
    uv('pyright', '--pythonpath', 'services/runtime/.venv/bin/python', 'services/runtime/src'),
  ]),
  'test:runtime': task('Build the Host, then run isolated Python tests.', [
    buildCoding,
    python('unittest', 'discover', '-s', 'tests', '-v'),
  ]),
  'build:runtime': task('Build the Runtime Sidecar on Apple Silicon macOS.', [buildRuntime]),
  ...Object.fromEntries(
    Object.entries(verification).map(([name, [description, module]]) => [
      `verify:${name}`,
      task(description, [python(`scripts.verify.${module}`)], true),
    ]),
  ),
}
