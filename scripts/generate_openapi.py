"""Write the Runtime OpenAPI document without starting a network listener."""

import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "services" / "runtime" / "src"))

from mlx_studio_runtime.entrypoints.http.app import create_app


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="mlx-studio-openapi-") as directory:
        app = create_app(
            session_token="schema-generation", database_path=Path(directory) / "app.db"
        )
        schema = app.openapi()
        app.state.service.store.close()
    output = Path(__file__).parents[1] / ".build" / "openapi.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(schema, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
