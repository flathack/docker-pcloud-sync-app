import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from app.schemas.settings import RcloneConfigStatus, RcloneConfigTestResult

SECTION_PATTERN = re.compile(r"^\[(?P<name>[^\]]+)\]$")


def _rclone_config_path() -> Path:
    configured = os.getenv("RCLONE_CONFIG", "./data/config/rclone/rclone.conf")
    path = Path(configured)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parents[3] / configured).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _extract_remotes(content: str) -> list[str]:
    remotes: list[str] = []
    for line in content.splitlines():
        match = SECTION_PATTERN.match(line.strip())
        if match:
            remotes.append(match.group("name"))
    return remotes


def get_rclone_config_status() -> RcloneConfigStatus:
    path = _rclone_config_path()
    if not path.exists():
        return RcloneConfigStatus(
            exists=False,
            config_path=str(path),
            remotes=[],
            is_valid=False,
            detail="Noch keine rclone.conf vorhanden.",
        )

    content = path.read_text(encoding="utf-8")
    remotes = _extract_remotes(content)
    stat = path.stat()
    updated_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()

    return RcloneConfigStatus(
        exists=True,
        config_path=str(path),
        file_size=stat.st_size,
        updated_at=updated_at,
        remotes=remotes,
        is_valid=len(remotes) > 0,
        detail="Konfiguration erkannt." if remotes else "Datei vorhanden, aber keine Remotes erkannt.",
    )


def save_rclone_config(filename: str, content: bytes) -> RcloneConfigStatus:
    if not filename.lower().endswith(".conf"):
        raise ValueError("Bitte eine .conf-Datei hochladen.")
    if not content.strip():
        raise ValueError("Die hochgeladene Datei ist leer.")

    path = _rclone_config_path()
    path.write_bytes(content)
    return get_rclone_config_status()


def test_rclone_remote(remote_name: str | None = None) -> RcloneConfigTestResult:
    status = get_rclone_config_status()
    if not status.exists:
        return RcloneConfigTestResult(ok=False, detail="Keine rclone.conf vorhanden.")
    if not status.remotes:
        return RcloneConfigTestResult(ok=False, detail="Keine Remotes in der rclone.conf gefunden.")

    selected_remote = remote_name or status.remotes[0]
    command = ["rclone", "lsd", f"{selected_remote}:"]
    result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=30)

    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "rclone-Test fehlgeschlagen.").strip()
        return RcloneConfigTestResult(ok=False, remote_name=selected_remote, detail=detail)

    detail = "Remote erfolgreich getestet."
    if result.stdout.strip():
        first_line = result.stdout.strip().splitlines()[0]
        detail = f"Remote erreichbar. Beispielausgabe: {first_line}"

    return RcloneConfigTestResult(ok=True, remote_name=selected_remote, detail=detail)
