import { command, node, python, task } from './commands.mjs'

export const acceptanceTasks = {
  'test:acceptance': task('Run portable acceptance-tool unit tests.', [
    node('--test', 'scripts/acceptance/acceptance.spec.mjs'),
  ]),
  'verify:packaged-runtime': task(
    'Check an explicitly selected packaged Sidecar.',
    [python('scripts.acceptance.verify_packaged_runtime')],
    true,
  ),
  'verify:shutdown': task(
    'Check shutdown of an explicitly selected packaged Sidecar.',
    [python('scripts.acceptance.verify_desktop_shutdown')],
    true,
  ),
  'verify:bundle': task(
    'Exercise packaged resources with explicit models or --fake-only.',
    [python('scripts.acceptance.verify_release_bundle')],
    true,
  ),
  'verify:data': task(
    'Check packaged data recovery with synthetic fixtures.',
    [node('scripts/acceptance/verify-packaged-data.mjs')],
    true,
  ),
  'verify:stability': task(
    "Run bundle acceptance using the selected app's Node; pass APP_PATH first.",
    [command('sh', 'scripts/acceptance/run-bundle-acceptance.sh')],
    true,
  ),
  'verify:kit': task(
    'Create a portable acceptance kit; pass a new output directory.',
    [command('sh', 'scripts/acceptance/package-acceptance-kit.sh')],
    true,
  ),
}
