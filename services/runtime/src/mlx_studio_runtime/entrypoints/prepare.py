"""One bounded preparation per child. stdout contains only a small status frame."""

import json
import resource
import sys
from pathlib import Path

from mlx_studio_runtime.adapters.prepare_content import prepare_content


def main() -> int:
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
        # Address-space limits on macOS are not a reliable RSS cap; CPU/time/output are enforced.
        if sys.platform != "darwin":
            resource.setrlimit(resource.RLIMIT_AS, (1536 * 1024**2, 1536 * 1024**2))
        request = json.loads(sys.stdin.buffer.read(16_384))
        prepare_content(Path(request["source"]), Path(request["staging"]), request["format"])
        print(json.dumps({"ok": True}))
        return 0
    except Exception as error:  # Child process boundary: never expose paths or extracted content.
        code = (
            str(error)
            if isinstance(error, ValueError) and str(error).startswith("ATTACHMENT_")
            else "ATTACHMENT_PARSE_FAILED"
        )
        print(json.dumps({"ok": False, "code": code}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
