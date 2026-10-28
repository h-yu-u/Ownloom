"""One-file Runtime bundle; policy lives in runtime_bundle.py."""

import os
import sys
from pathlib import Path

root = Path(SPECPATH).resolve().parents[1]
sys.path.insert(0, str(root))

from scripts.build.runtime_bundle import collect_runtime, runtime_entries

source = root / "services/runtime/src"
collection = collect_runtime(os.environ.get("MLX_STUDIO_BUILD_PROFILE", "release"))
analysis = Analysis(
    [str(source / "mlx_studio_runtime/entrypoints/http/main.py")],
    pathex=[str(source)],
    binaries=collection.binaries,
    datas=collection.datas,
    hiddenimports=collection.hiddenimports,
    excludes=collection.excludes,
)
# Upstream hooks retain native libraries, dynamic plugins and required raw Python
# sources. Only the independently identified NumPy/SciPy tests trees are removed.
analysis.pure = runtime_entries(analysis.pure)
analysis.datas = runtime_entries(analysis.datas)
analysis.binaries = runtime_entries(analysis.binaries)

archive = PYZ(analysis.pure)
executable = EXE(
    archive,
    analysis.scripts,
    analysis.binaries,
    analysis.datas,
    [],
    name="mlx-studio-runtime",
    console=True,
    target_arch="arm64",
)
