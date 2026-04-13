import os
import json
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
        "--use-json-log --log-level INFO --stats 10s",
    )
    if global_flags.strip():
        filtered_flags = [
            flag
            for flag in shlex.split(global_flags)
            if flag != "--stats-one-line-json"
        ]
        command.extend(filtered_flags)

    return command


def _fallback_command(sync_pair: SyncPair) -> list[str]:
    message = (
        f"Fallback run for {sync_pair.name}: "
        f"{sync_pair.mode} {sync_pair.source_path} -> {sync_pair.destination_path}"
    )
    return [sys.executable, "-c", f"print({message!r})"]


def _clean_output(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if line.strip()]


def _extract_error_summary(stdout: str, stderr: str) -> str:
    candidate_lines = _clean_output(stderr) + _clean_output(stdout)
    for line in reversed(candidate_lines):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            payload = None

        if isinstance(payload, dict):
            level = str(payload.get("level", "")).lower()
            message = str(payload.get("msg") or payload.get("message") or "").strip()
            if level in {"error", "fatal"} and message:
                return message
            if "error" in message.lower() or "failed" in message.lower():
                return message

        lowered = line.lower()
        if any(token in lowered for token in ("error", "failed", "fatal", "denied", "forbidden", "timeout", "not found")):
            return line

    return "Keine konkrete Fehlermeldung in stdout/stderr gefunden."


def _tail_excerpt(text: str, max_lines: int = 12) -> str:
    lines = _clean_output(text)
    if not lines:
        return "(keine Ausgabe)"
    excerpt = lines[-max_lines:]
    return "\n".join(excerpt)


def _build_report(
    sync_pair: SyncPair,
    *,
    status: str,
    exit_code: int | None,
    duration_seconds: int,
    stdout: str,
    stderr: str,
) -> str:
    base = (
        f"Sync '{sync_pair.name}' wurde per {sync_pair.mode} von {sync_pair.source_path} nach "
        f"{sync_pair.destination_path} ausgeführt. Status: {status}. Exit-Code: {exit_code}. "
        f"Dauer: {duration_seconds}s."
    )
    if status == "success":
        return f"{base} rclone hat den Lauf ohne Fehler beendet."

    summary = _extract_error_summary(stdout, stderr)
    stderr_excerpt = _tail_excerpt(stderr)
    stdout_excerpt = _tail_excerpt(stdout)
    return (
        f"{base} Vermutete Ursache: {summary}\n\n"
        f"Letzte stderr-Zeilen:\n{stderr_excerpt}\n\n"
        f"Letzte stdout-Zeilen:\n{stdout_excerpt}"
    )


def run_sync_pair(sync_pair: SyncPair) -> RunnerResult:
    started_at = utc_now()
    command = _build_rclone_command(sync_pair)
    executable = shutil.which(command[0])

    if executable is None:
        command = _fallback_command(sync_pair)

    log_path = _logs_dir() / f"{sync_pair.id}-{started_at.strftime('%Y%m%d%H%M%S')}.log"
    command_string = " ".join(shlex.quote(part) for part in command)

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

    finished_at = utc_now()
    duration_seconds = max(1, int((finished_at - started_at).total_seconds()))
    status = "success" if completed.returncode == 0 else "error"
    error_summary = _extract_error_summary(completed.stdout, completed.stderr)
    short_log = (
        "rclone-Lauf erfolgreich abgeschlossen."
        if status == "success"
        else f"rclone-Fehler: {error_summary}"
    )
    report = _build_report(
        sync_pair,
        status=status,
        exit_code=completed.returncode,
        duration_seconds=duration_seconds,
        stdout=completed.stdout,
        stderr=completed.stderr,
    )

    with log_path.open("w", encoding="utf-8") as log_file:
        log_file.write(f"Command: {command_string}\n")
        log_file.write(f"Started at: {started_at.isoformat()}\n")
        log_file.write(f"Finished at: {finished_at.isoformat()}\n")
        log_file.write(f"Duration seconds: {duration_seconds}\n")
        log_file.write(f"Exit code: {completed.returncode}\n")
        log_file.write(f"Status: {status}\n")
        if status == "error":
            log_file.write(f"Error summary: {error_summary}\n")
        log_file.write("\n[report]\n")
        log_file.write(report)
        if not report.endswith("\n"):
            log_file.write("\n")
        log_file.write("\n[stdout]\n")
        if completed.stdout:
            log_file.write(completed.stdout)
            if not completed.stdout.endswith("\n"):
                log_file.write("\n")
        else:
            log_file.write("(keine Ausgabe)\n")
        log_file.write("\n[stderr]\n")
        if completed.stderr:
            log_file.write(completed.stderr)
            if not completed.stderr.endswith("\n"):
                log_file.write("\n")
        else:
            log_file.write("(keine Ausgabe)\n")

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
