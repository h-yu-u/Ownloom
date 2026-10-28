"""Copy MLX response scalars without deriving new timing or token measurements."""

from mlx_studio_runtime.domain.generation_stats import GenerationStats, read_generation_stats


def native_generation_stats(engine: str, response: object) -> GenerationStats | None:
    return read_generation_stats(
        {
            "source": engine,
            "generationTokens": getattr(response, "generation_tokens", None),
            "generationTps": getattr(response, "generation_tps", None),
            "promptTokens": getattr(response, "prompt_tokens", None),
            "promptTps": getattr(response, "prompt_tps", None),
            "cachedTokens": getattr(response, "cached_tokens", None),
        }
    )
