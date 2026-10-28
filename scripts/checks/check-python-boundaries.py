"""AST-based Python dependency gate; accepts a fixture root for self-tests."""

import ast
import sys
from pathlib import Path


def inspect(root: Path) -> list[str]:
    files = {
        ".".join(path.relative_to(root).with_suffix("").parts): path
        for path in root.rglob("*.py")
    }
    errors: list[str] = []
    graph: dict[str, set[str]] = {name: set() for name in files}
    for name, path in files.items():
        tree = ast.parse(path.read_text(), filename=str(path))
        domain = ".domain." in f".{name}."
        application = ".application." in f".{name}."
        for node in ast.walk(tree):
            imports: list[str] = []
            if isinstance(node, ast.Import):
                imports = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                prefix = node.module or ""
                if node.level:
                    parts = name.split(".")[: -node.level]
                    prefix = ".".join([*parts, prefix]).strip(".")
                imports = [prefix, *[f"{prefix}.{alias.name}" for alias in node.names]]
            for dependency in imports:
                if dependency in files:
                    graph[name].add(dependency)
                if domain and (
                    any(
                        part in dependency.split(".")
                        for part in ["adapters", "application", "entrypoints"]
                    )
                    or dependency.split(".")[0]
                    in {
                        "fastapi",
                        "pydantic",
                        "sqlite3",
                        "mlx",
                        "mlx_lm",
                        "mlx_vlm",
                        "mflux",
                        "os",
                        "pathlib",
                    }
                ):
                    errors.append(
                        f"{path}:{node.lineno}: domain depends on {dependency}"
                    )
                if application and any(
                    part in dependency.split(".")
                    for part in ["adapters", "entrypoints"]
                ):
                    errors.append(
                        f"{path}:{node.lineno}: application depends on {dependency}"
                    )
            if (
                domain
                and isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "open"
            ):
                errors.append(f"{path}:{node.lineno}: domain performs file I/O")
    visited, active = set(), set()

    def visit(name: str) -> None:
        if name in active:
            errors.append(f"{name}: dependency cycle")
            return
        if name in visited:
            return
        active.add(name)
        for dependency in graph[name]:
            visit(dependency)
        active.remove(name)
        visited.add(name)

    for name in files:
        visit(name)
    return sorted(set(errors))


if __name__ == "__main__":
    failures = inspect(Path(sys.argv[1]))
    print(
        "\n".join(failures) if failures else "Python AST dependency boundaries passed."
    )
    sys.exit(bool(failures))
