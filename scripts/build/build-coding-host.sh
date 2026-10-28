#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"
node -e 'if (Number(process.versions.node.split(".")[0]) !== 22 || process.arch !== "arm64" || process.platform !== "darwin") throw new Error("Coding bundle requires Node 22 on Apple Silicon macOS")'
pnpm --filter @mlx-studio/coding-agent build
bundle_directory="$repo_root/apps/desktop/src-tauri/resources/coding-agent"
mkdir -p "$(dirname "$bundle_directory")"
# Clear both dependency selectors: pnpm 11 normalizes either true selector to an only-install.
# Restore on success and failure because legacy deploy persists its selection in workspace state.
restore_workspace() {
  CI=true pnpm install --frozen-lockfile --prod=false --dev=false
  test -x "$repo_root/apps/desktop/node_modules/.bin/tauri"
  test -x "$repo_root/apps/desktop/node_modules/.bin/vue-tsc"
  node --input-type=module -e 'await import("./services/coding-agent/dist/adapters/pi-session.js")'
}
trap restore_workspace EXIT
CI=true pnpm --filter @mlx-studio/coding-agent deploy --prod --legacy --config.node-linker=hoisted "$repo_root/.build/coding-deploy"
mkdir -p "$repo_root/.build/coding-deploy/bin"
node_path="$(node -p 'process.execPath')"
install -m 755 "$node_path" "$repo_root/.build/coding-deploy/bin/node"
# Build output only. User projects, model files and global Pi data are never copied.
rm -rf "$bundle_directory"
mv "$repo_root/.build/coding-deploy" "$bundle_directory"
node scripts/build/validate-coding-bundle.mjs "$bundle_directory"
"$bundle_directory/bin/node" --input-type=module -e 'import("./apps/desktop/src-tauri/resources/coding-agent/dist/adapters/pi-session.js").then(() => process.stderr.write("Bundled Pi adapter loaded.\n"))'

