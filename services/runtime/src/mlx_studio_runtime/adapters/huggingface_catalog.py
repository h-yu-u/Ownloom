"""Bounded, anonymous read access to the public Hugging Face model catalog."""

import json
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from mlx_studio_runtime.domain.errors import RuntimeErrorInfo, RuntimeFault
from mlx_studio_runtime.domain.model_catalog import HubModel, read_hub_models

CATALOG_ENDPOINT = "https://huggingface.co/api/models"
CATALOG_TIMEOUT_SECONDS = 12
MAX_RESPONSE_BYTES = 2 * 1024 * 1024


def search_mlx_models(query: str, limit: int) -> tuple[HubModel, ...]:
    params = urlencode(
        {
            "filter": "mlx",
            "search": query.strip(),
            "sort": "downloads",
            "direction": "-1",
            "limit": str(limit),
        }
    )
    request = Request(
        f"{CATALOG_ENDPOINT}?{params}",
        headers={"Accept": "application/json", "User-Agent": "MLX-Studio/0.1"},
    )
    try:
        with urlopen(request, timeout=CATALOG_TIMEOUT_SECONDS) as response:
            content = response.read(MAX_RESPONSE_BYTES + 1)
        if len(content) > MAX_RESPONSE_BYTES:
            raise ValueError("Hugging Face catalog response is too large")
        payload: object = json.loads(content)
        return read_hub_models(payload)
    except (URLError, OSError, ValueError) as error:
        raise RuntimeFault(
            RuntimeErrorInfo(
                "HF_CATALOG_NOT_AVAILABLE",
                "无法获取 Hugging Face 模型，请检查网络后重试。",
                retryable=True,
            )
        ) from error
