"""Pure checks for the shared internal schema; never include payloads in errors."""

import math
import re
from typing import Any

from mlx_studio_runtime.domain.generated.coding_rpc import SCHEMA


def conforms(value: object, rule: dict[str, Any]) -> bool:
    if "$ref" in rule:
        return conforms(value, SCHEMA["$defs"][rule["$ref"].split("/")[-1]])
    if "anyOf" in rule:
        return any(conforms(value, item) for item in rule["anyOf"])
    if "enum" in rule and value not in rule["enum"]:
        return False
    kind = rule.get("type")
    if kind == "null":
        return value is None
    if kind == "string":
        return (
            isinstance(value, str)
            and ("pattern" not in rule or re.search(rule["pattern"], value) is not None)
            and len(value) >= rule.get("minLength", 0)
            and len(value) <= rule.get("maxLength", math.inf)
        )
    if kind == "boolean":
        return isinstance(value, bool)
    if kind in {"integer", "number"}:
        return (
            isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(value)
            and (kind != "integer" or value == int(value))
            and value >= rule.get("minimum", -math.inf)
            and value <= rule.get("maximum", math.inf)
        )
    if kind == "array":
        return (
            isinstance(value, list)
            and len(value) <= rule.get("maxItems", math.inf)
            and all(conforms(item, rule.get("items", {})) for item in value)
        )
    if kind == "object":
        if not isinstance(value, dict):
            return False
        if any(key not in value for key in rule.get("required", [])):
            return False
        for key, item in value.items():
            field = rule.get("properties", {}).get(key, rule.get("additionalProperties", True))
            if field is False or (isinstance(field, dict) and not conforms(item, field)):
                return False
    return True


def validate_rpc(method: str, kind: str, value: object) -> None:
    spec = SCHEMA["methods"].get(method)
    if spec is None:
        raise ValueError("UNKNOWN_METHOD")
    if not conforms(value, spec[kind]):
        raise ValueError("INVALID_PARAMS" if kind == "params" else "RPC_RESULT_INVALID")
