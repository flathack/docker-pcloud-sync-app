import os
import shlex
import subprocess
from pathlib import Path

from app.schemas.browser import BrowserEntry, BrowserResponse


def _configured_roots() -> list[Path]:
    roots_env = os.getenv("FILE_BROWSER_ROOTS", "/mnt,/app/backend/data")
    roots: list[Path] = []
    for item in roots_env.split(","):
        cleaned = item.strip()
        if not cleaned:
            continue
        path = Path(cleaned).resolve()
        if path.exists():
            roots.append(path)
    return roots


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _parent_within_roots(path: Path, roots: list[Path]) -> str | None:
    parent = path.parent
    if parent == path:
        return None
    if any(_is_relative_to(parent, root) or parent == root for root in roots):
        return str(parent)
    return None


def _browse_local(path_value: str | None) -> BrowserResponse:
    roots = _configured_roots()
    if not roots:
        return BrowserResponse(current_path="", parent_path=None, backend_type="local", entries=[])

    if not path_value:
        entries = [
            BrowserEntry(name=root.name or str(root), path=str(root), entry_type="root")
            for root in roots
        ]
        return BrowserResponse(current_path="", parent_path=None, backend_type="local", entries=entries)

    requested_path = Path(path_value).resolve()
    if not requested_path.exists() or not requested_path.is_dir():
        raise FileNotFoundError(f"Pfad nicht gefunden: {path_value}")

    if not any(_is_relative_to(requested_path, root) or requested_path == root for root in roots):
        raise PermissionError("Pfad liegt ausserhalb der erlaubten Browser-Wurzeln")

    entries = [
        BrowserEntry(name=entry.name, path=str(entry), entry_type="directory")
        for entry in sorted(requested_path.iterdir(), key=lambda item: item.name.lower())
        if entry.is_dir()
    ]
    return BrowserResponse(
        current_path=str(requested_path),
        parent_path=_parent_within_roots(requested_path, roots),
        backend_type="local",
        entries=entries,
    )


def _remote_parent(path_value: str) -> str | None:
    if ":" not in path_value:
        return None
    remote, _, tail = path_value.partition(":")
    tail = tail.strip("/")
    if not tail:
        return None
    parts = tail.split("/")
    if len(parts) == 1:
        return f"{remote}:"
    return f"{remote}:/{'/'.join(parts[:-1])}"


def _browse_remote(path_value: str) -> BrowserResponse:
    target = path_value or os.getenv("DEFAULT_REMOTE_ROOT", "pcloud:")
    command = ["rclone", "lsf", target, "--dirs-only", "--max-depth", "1"]
    result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=30)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "rclone browse failed").strip())

    base = target.rstrip("/")
    entries = []
    for line in result.stdout.splitlines():
        name = line.rstrip("/").strip()
        if not name:
            continue
        if base.endswith(":"):
            entry_path = f"{base}/{name}"
        else:
            entry_path = f"{base}/{name}"
        entries.append(BrowserEntry(name=name, path=entry_path, entry_type="directory"))

    return BrowserResponse(
        current_path=target,
        parent_path=_remote_parent(target),
        backend_type="remote",
        entries=entries,
    )


def browse(path_value: str | None, backend_type: str = "local") -> BrowserResponse:
    if backend_type == "remote":
        return _browse_remote(path_value or "")
    return _browse_local(path_value)


def create_directory(path_value: str | None, directory_name: str, backend_type: str = "local") -> BrowserResponse:
    clean_name = directory_name.strip().strip("/").strip()
    if not clean_name or "/" in clean_name or "\\" in clean_name:
        raise RuntimeError("Bitte einen gueltigen Ordnernamen ohne Pfadtrenner angeben.")

    if backend_type == "remote":
        base_path = path_value or os.getenv("DEFAULT_REMOTE_ROOT", "pcloud:")
        target = f"{base_path.rstrip('/')}/{clean_name}" if not base_path.endswith(":") else f"{base_path}/{clean_name}"
        result = subprocess.run(["rclone", "mkdir", target], capture_output=True, text=True, check=False, timeout=30)
        if result.returncode != 0:
            raise RuntimeError((result.stderr or result.stdout or "Ordner konnte remote nicht angelegt werden").strip())
        return _browse_remote(base_path)

    roots = _configured_roots()
    if not roots:
        raise RuntimeError("Keine lokalen Browser-Wurzeln konfiguriert.")

    base_path = Path(path_value).resolve() if path_value else roots[0]
    if not any(_is_relative_to(base_path, root) or base_path == root for root in roots):
        raise PermissionError("Pfad liegt ausserhalb der erlaubten Browser-Wurzeln")

    target = (base_path / clean_name).resolve()
    if not any(_is_relative_to(target, root) or target == root for root in roots):
        raise PermissionError("Der neue Ordner liegt ausserhalb der erlaubten Browser-Wurzeln")

    target.mkdir(parents=False, exist_ok=True)
    return _browse_local(str(base_path))
