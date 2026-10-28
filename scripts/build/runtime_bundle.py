"""Runtime bundle policy: dynamic registries, resources and narrow test exclusions."""

from collections.abc import Iterable
from dataclasses import dataclass, field
from importlib.metadata import Distribution, distribution

# Ordinary imports and their native libraries are handled by the upstream hooks.
# These packages resolve names dynamically; enumerate wheel records without importing
# models during analysis (some upstream modules otherwise download or initialize).
BASE_REGISTRIES = {
    "huggingface-hub": ("huggingface_hub",),
    "tiktoken": ("tiktoken_ext",),
}
ENGINE_REGISTRIES = {
    "mlx": ("mlx",),
    "mlx-lm": ("mlx_lm.models",),
    "mlx-vlm": (
        "mlx_vlm.models",
        "mlx_vlm.speculative.drafters",
        "mlx_vlm.tool_parsers",
    ),
    "transformers": ("transformers",),
    "tokenizers": ("tokenizers",),
    "mlx-audio": ("mlx_audio.tts.models.qwen3_tts",),
    # SciPy 1.18's vendored backends compute their fft/linalg import names.
    # Keep both installed array backends; ordinary SciPy and array_api_extra
    # imports still follow the upstream hooks and static dependency graph.
    "scipy": (
        "scipy._external.array_api_compat.numpy",
        "scipy._external.array_api_compat.torch",
    ),
}
MFLUX_ENTRYPOINTS = (
    "mflux.models.flux.variants.txt2img.flux",
    "mflux.models.qwen.variants.txt2img.qwen_image",
    "mflux.models.qwen21.variants.txt2img.qwen_image_21",
    "mflux.models.qwen21.variants.edit.qwen_image_21_edit",
)
BASE_METADATA = (
    "huggingface-hub",
    "pypdf",
    "python-docx",
    "pillow",
    "httpx",
    "tavily-python",
    "tiktoken",
    "keyring",
)
ENGINE_METADATA = (
    "mlx",
    "mlx-metal",
    "mlx-lm",
    "mlx-vlm",
    "mflux",
    "mlx-audio",
    "transformers",
    "tokenizers",
    "numpy",
    "scipy",
    "miniaudio",
    "sounddevice",
)
BASE_DATA = ("huggingface_hub", "tiktoken")
# Keep model-owned resources, including MFLUX's positional embeddings and MLX's
# Metal headers/metallib. Some VLM models read those headers at runtime.
ENGINE_DATA = (
    "mlx",
    "mlx_lm",
    "mlx_vlm",
    "mflux",
    "mlx_audio",
    "transformers",
    "tokenizers",
)
AUDIO_EXCLUDES = ("mlx_audio.stt", "mlx_audio.sts", "mlx_audio.vad", "mlx_audio.lid")

TocEntry = tuple[str, str, str]


def is_numerical_test(name: str) -> bool:
    """Match NumPy/SciPy tests trees in archive paths or dotted module names.

    Public `testing` helpers, `_multiarray_tests` extensions and unrelated packages
    such as `jinja2.tests` are deliberately retained.
    """
    normalized = name.replace("\\", "/")
    parts = normalized.split("/") if "/" in normalized else normalized.split(".")
    return parts[0] in {"numpy", "scipy"} and "tests" in parts[1:]


def runtime_entries(entries: Iterable[TocEntry]) -> list[TocEntry]:
    """Apply the same narrow boundary to code, data and binary TOC entries."""
    return [entry for entry in entries if not is_numerical_test(entry[0])]


def distribution_modules(
    installed: Distribution, prefixes: tuple[str, ...]
) -> list[str]:
    """Find registry modules from installed wheel records, without executing code."""
    if installed.files is None:
        raise ValueError("Installed distribution has no file manifest")
    modules = set()
    for path in installed.files:
        if path.suffix != ".py":
            continue
        parts = list(path.with_suffix("").parts)
        if parts[-1] == "__init__":
            parts.pop()
        if not parts or path.is_absolute() or ".." in parts:
            continue
        # importlib supports names such as mlx_lm.models.lfm2-vl; requiring Python
        # identifiers here would silently remove supported dynamic model names.
        name = ".".join(parts)
        if any(name == prefix or name.startswith(prefix + ".") for prefix in prefixes):
            modules.add(name)
    for prefix in prefixes:
        if not any(name == prefix or name.startswith(prefix + ".") for name in modules):
            raise ValueError(f"Dynamic module registry is missing: {prefix}")
        modules.add(prefix)  # Namespace packages may have no __init__.py record.
    return sorted(modules)


@dataclass
class BundleCollection:
    hiddenimports: list[str] = field(default_factory=list)
    datas: list[tuple[str, str]] = field(default_factory=list)
    binaries: list[tuple[str, str]] = field(default_factory=list)
    excludes: list[str] = field(default_factory=list)


def collect_runtime(profile: str) -> BundleCollection:
    """Collect explicit additions; retain PyInstaller's standard package hooks."""
    if profile not in {"release", "fake"}:
        raise ValueError(f"Unknown Runtime build profile: {profile}")
    from PyInstaller.utils.hooks import (
        collect_data_files,
        collect_dynamic_libs,
        copy_metadata,
    )

    result = BundleCollection(hiddenimports=["keyring.backends.macOS"])
    registries = dict(BASE_REGISTRIES)
    packages, metadata = list(BASE_DATA), list(BASE_METADATA)
    if profile == "release":
        registries.update(ENGINE_REGISTRIES)
        packages.extend(ENGINE_DATA)
        metadata.extend(ENGINE_METADATA)
        # The bundle probe imports audio support dynamically. Keep these explicit
        # so sounddevice's upstream hook also collects its PortAudio library.
        result.hiddenimports.extend(
            (
                *MFLUX_ENTRYPOINTS,
                "torch",
                "cv2",
                "scipy.signal",
                "miniaudio",
                "sounddevice",
            )
        )
        result.excludes.extend(AUDIO_EXCLUDES)
        result.binaries.extend(collect_dynamic_libs("mlx"))
    else:
        result.excludes.extend(("mlx", "mlx_lm", "mlx_vlm", "mflux", "mlx_audio"))
    for name, prefixes in registries.items():
        result.hiddenimports.extend(distribution_modules(distribution(name), prefixes))
    for package in packages:
        # This controls only our explicit data collection. In particular, the
        # Torch/Transformers hooks retain their required pyz+py collection mode.
        result.datas.extend(collect_data_files(package, include_py_files=False))
    for name in metadata:
        result.datas.extend(copy_metadata(name))
    result.hiddenimports = sorted(set(result.hiddenimports))
    return result
