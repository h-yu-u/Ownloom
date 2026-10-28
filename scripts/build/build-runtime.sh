#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
runtime_project="$repo_root/services/runtime"
target_triple="aarch64-apple-darwin"
output_directory="$repo_root/apps/desktop/src-tauri/binaries"
build_directory="$repo_root/.build/runtime"
profile="${MLX_STUDIO_BUILD_PROFILE:-release}"
engine_flags=()
if [[ "$profile" == "release" ]]; then
  engine_flags=(--extra mlx-lm --extra mlx-vlm --extra mflux --extra audio)
elif [[ "$profile" != "fake" ]]; then
  echo "Build profile must be release or fake." >&2
  exit 2
fi
export UV_PROJECT_ENVIRONMENT="$build_directory/venv-$profile"
export MLX_STUDIO_BUILD_PROFILE="$profile"
# Collecting unrelated upstream models can execute download code at import time.
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export PYINSTALLER_CONFIG_DIR="$build_directory/pyinstaller-$profile"
# Keep host modules from overriding the precisely synced build dependencies.
export PYTHONPATH="$runtime_project/src"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Runtime sidecar must be built on Apple Silicon macOS (arm64)." >&2
  exit 2
fi

cd "$repo_root"
mkdir -p "$output_directory"
# Exact sync removes stale extras/dev dependencies from a reused build environment.
uv sync --frozen --no-dev --project "$runtime_project" --python 3.12 \
  --group build "${engine_flags[@]}"
uv run --no-sync --project "$runtime_project" --python 3.12 \
  pyinstaller --clean --noconfirm \
  --distpath "$build_directory/dist" \
  --workpath "$build_directory/work" \
  "$repo_root/scripts/build/runtime.spec"

install -m 755 "$build_directory/dist/mlx-studio-runtime" \
  "$output_directory/mlx-studio-runtime-$target_triple"
uv run --no-sync --project "$runtime_project" --python 3.12 \
  python -m scripts.build.report_runtime_bundle \
  --sidecar "$output_directory/mlx-studio-runtime-$target_triple" \
  --output "$build_directory/archive-size.json" --profile "$profile"
