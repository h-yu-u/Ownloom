"""Import-only failure diagnostics without prompts, file paths or arbitrary exception text."""

import re
import traceback
from pathlib import Path


def import_failure_chain(error: BaseException) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    seen: set[int] = set()
    current: BaseException | None = error
    while current is not None and id(current) not in seen and len(result) < 8:
        seen.add(id(current))
        module = getattr(current, "name", None)
        if module is None and isinstance(current, ModuleNotFoundError):
            match = re.search(
                r"(?:No module named|Could not import module) ['\"]([\w.]+)['\"]", str(current)
            )
            module = match[1] if match else None
        result.append(
            {
                "type": type(current).__name__,
                "module": module,
                "frames": [
                    (Path(frame.filename).name, frame.name, frame.lineno)
                    for frame in traceback.extract_tb(current.__traceback__)
                ],
            }
        )
        current = current.__cause__ or current.__context__
    return result
