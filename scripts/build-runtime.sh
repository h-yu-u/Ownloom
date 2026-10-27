#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
runtime_project="$repo_root/services/runtime"
target_triple="aarch64-apple-darwin"
output_directory="$repo_root/apps/desktop/src-tauri/binaries"
build_directory="$repo_root/.build/runtime"
profile="${MLX_STUDIO_BUILD_PROFILE:-release}"
engine_flags=()
collect_flags=()
if [[ "$profile" == "release" ]]; then
  engine_flags=(--extra mlx-lm --extra mlx-vlm --extra mflux --extra audio)
  collect_flags=(--collect-all mlx --collect-all mlx_lm --collect-all mlx_vlm --collect-all mflux
    --collect-all transformers --collect-all tokenizers --collect-all huggingface_hub
    --collect-all scipy --copy-metadata mlx-audio --collect-data mlx_audio
    --hidden-import mlx_audio.tts.models.qwen3_tts --exclude-module mlx_audio.stt
    --exclude-module mlx_audio.sts --exclude-module mlx_audio.vad --exclude-module mlx_audio.lid
    --collect-all miniaudio
    --collect-all sounddevice --collect-all numpy)
elif [[ "$profile" == "fake" ]]; then
  collect_flags=(--exclude-module mlx --exclude-module mlx_lm --exclude-module mlx_vlm --exclude-module mflux --exclude-module mlx_audio)
elif [[ "$profile" != "fake" ]]; then
  echo "Build profile must be release or fake." >&2
  exit 2
fi
export UV_PROJECT_ENVIRONMENT="$build_directory/venv-$profile"
# Collecting unrelated upstream models can execute download code at import time.
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export PYINSTALLER_CONFIG_DIR="$build_directory/pyinstaller-$profile"
export PYTHONPATH="$runtime_project/src${PYTHONPATH:+:$PYTHONPATH}"

mkdir -p "$output_directory"
if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Runtime sidecar must be built on Apple Silicon macOS (arm64)." >&2
  exit 2
fi

uv run --frozen --project "$runtime_project" --python 3.12 \
  --group build "${engine_flags[@]}" \
  pyinstaller --clean --noconfirm --onefile \
  --name mlx-studio-runtime \
  --distpath "$build_directory/dist" \
  --workpath "$build_directory/work" \
  --specpath "$build_directory/spec" \
  --paths "$runtime_project/src" \
  --collect-all mlx_studio_runtime \
  --collect-all pypdf --collect-all docx --collect-all PIL --collect-all lxml \
  --collect-all httpx --collect-all tavily --collect-all tiktoken \
  --hidden-import keyring.backends.macOS --copy-metadata keyring \
  "${collect_flags[@]}" \
  "$runtime_project/src/mlx_studio_runtime/entrypoints/http/main.py"

install -m 755 "$build_directory/dist/mlx-studio-runtime" \
  "$output_directory/mlx-studio-runtime-$target_triple"
