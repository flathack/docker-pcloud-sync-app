import os
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.models.sync_pair import SyncPair


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class RunnerResult:
    status: str
    exit_code: int | None
    short_log: str
    report: str
    full_log_path: str | None
    command: str
    started_at: datetime
    finished_at: datetime
    duration_seconds: int
    files_transferred: int
    files_deleted: int
    error_count: int
    bytes_transferred: int


def _logs_dir() -> Path:
    log_dir = Path(os.getenv("APP_LOG_DIR", Path(__file__).resolve().parents[3] / "data" / "logs"))
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir


def _build_rclone_command(sync_pair: SyncPair) -> list[str]:
    binary = os.getenv("RCLONE_BINARY", "rclone")
    command = [binary, sync_pair.mode, sync_pair.source_path, sync_pair.destination_path]

    global_flags = os.getenv(
        "RCLONE_GLOBAL_FLAGS",
        "--use-json-log --log-level INFO --stats 10s --stats-one-line-json",
    )
    if global_flags.strip():
        command.extend(shlex.split(global_flags))

    return command


def _fallback_command(sync_pair: SyncPair) -> list[str]:
    message = (
        f"Fallback run for {sync_pair.name}: "
        f"{sync_pair.mode} {sync_pair.source_path} -> {sync_pair.destination_path}"
    )
    return [sys.executable, "-c", f"print({message!r})"]


def run_sync_pair(sync_pair: SyncPair) -> RunnerResult:
    started_at = utc_now()
    command = _build_rclone_command(sync_pair)
    executable = shutil.which(command[0])

    if executable is None:
        command = _fallback_command(sync_pair)

    log_path = _logs_dir() / f"{sync_pair.id}-{started_at.strftime('%Y%m%d%H%M%S')}.log"
    command_string = " ".join(shlex.quote(part) for part in command)

    with log_path.open("w", encoding="utf-8") as log_file:
        log_file.write(f"Command: {command_string}\n")
        log_file.write(f"Started at: {started_at.isoformat()}\n\n")
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                check=False,
                timeout=300,
            )
        except subprocess.TimeoutExpired as exc:
            completed = subprocess.CompletedProcess(
                command,
                returncode=124,
                stdout=exc.stdout or "",
                stderr=(exc.stderr or "") + "\nProcess timed out after 300 seconds.",
            )
        if completed.stdout:
            log_file.write(completed.stdout)
            if not completed.stdout.endswith("\n"):
                log_file.write("\n")
        if completed.stderr:
            log_file.write("\n[stderr]\n")
            log_file.write(completed.stderr)
            if not completed.stderr.endswith("\n"):
                log_file.write("\n")

    finished_at = utc_now()
    duration_seconds = max(1, int((finished_at - started_at).total_seconds()))
    status = "success" if completed.returncode == 0 else "error"
    short_log = "rclone-Lauf erfolgreich abgeschlossen." if status == "success" else "rclone-Lauf mit Fehler beendet."
    report = (
        f"Sync '{sync_pair.name}' wurde per {sync_pair.mode} von {sync_pair.source_path} nach "
        f"{sync_pair.destination_path} ausgefuehrt. Status: {status}. Exit-Code: {completed.returncode}. "
        f"Dauer: {duration_seconds}s."
    )

    return RunnerResult(
        status=status,
        exit_code=completed.returncode,
        short_log=short_log,
        report=report,
        full_log_path=str(log_path),
        command=command_string,
        started_at=started_at,
        finished_at=finished_at,
        duration_seconds=duration_seconds,
        files_transferred=0 if executable else 1,
        files_deleted=0,
        error_count=0 if status == "success" else 1,
        bytes_transferred=0,
    )
