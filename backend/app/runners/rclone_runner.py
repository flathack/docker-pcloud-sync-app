import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.models.sync_pair import SyncPair

BYTE_TOKEN_PATTERN = re.compile(r"(?P<value>\d+(?:[.,]\d+)?)\s*(?P<unit>[KMGTPE]?i?B)")
FILE_TRANSFERRED_PATTERN = re.compile(r"Transferred:\s*(?P<count>\d+)\s*/\s*\d+", re.IGNORECASE)
BYTE_TRANSFERRED_PATTERN = re.compile(
    r"Transferred:\s*(?P<value>\d+(?:[.,]\d+)?)\s*(?P<unit>[KMGTPE]?i?B|B)\s*/",
    re.IGNORECASE,
)
ERROR_COUNT_PATTERN = re.compile(r"Errors:\s*(?P<count>\d+)", re.IGNORECASE)
DELETED_COUNT_PATTERN = re.compile(r"Deleted:\s*(?P<count>\d+)", re.IGNORECASE)
SPEED_PATTERN = re.compile(
    r"(?P<value>\d+(?:[.,]\d+)?)\s*(?P<unit>[KMGTPE]?i?B|B)/s",
    re.IGNORECASE,
)
FILE_EVENT_PATTERN = re.compile(
    r"(Copied|Moved|Updated|Transferred|Renamed)",
    re.IGNORECASE,
)


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
    average_speed_bytes_per_second: int


@dataclass
class ParsedStats:
    files_transferred: int = 0
    files_deleted: int = 0
    error_count: int = 0
    bytes_transferred: int = 0
    average_speed_bytes_per_second: int = 0


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


def _extract_messages(text: str) -> list[str]:
    messages: list[str] = []
    for line in _clean_output(text):
        messages.append(line)
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            message = str(payload.get("msg") or payload.get("message") or "").strip()
            if message:
                messages.append(message)
    return messages


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


def _parse_size_to_bytes(value: str, unit: str) -> int:
    normalized_value = float(value.replace(",", "."))
    normalized_unit = unit.upper()
    factors = {
        "B": 1,
        "KB": 1000,
        "MB": 1000**2,
        "GB": 1000**3,
        "TB": 1000**4,
        "PB": 1000**5,
        "KIB": 1024,
        "MIB": 1024**2,
        "GIB": 1024**3,
        "TIB": 1024**4,
        "PIB": 1024**5,
    }
    factor = factors.get(normalized_unit)
    if factor is None:
        return 0
    return int(normalized_value * factor)


def _format_bytes(value: int) -> str:
    if value <= 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB", "PB"]
    current = float(value)
    index = 0
    while current >= 1024 and index < len(units) - 1:
        current /= 1024
        index += 1
    precision = 0 if current >= 10 or index == 0 else 2
    return f"{current:.{precision}f} {units[index]}"


def _format_speed(bytes_per_second: int) -> str:
    if bytes_per_second <= 0:
        return "0 B/s"
    return f"{_format_bytes(bytes_per_second)}/s"


def _parse_stats(stdout: str, stderr: str, duration_seconds: int) -> ParsedStats:
    stats = ParsedStats()
    combined_messages = _extract_messages(stdout) + _extract_messages(stderr)

    per_file_events = 0

    for message in combined_messages:
        file_match = FILE_TRANSFERRED_PATTERN.search(message)
        if file_match:
            stats.files_transferred = max(stats.files_transferred, int(file_match.group("count")))

        byte_match = BYTE_TRANSFERRED_PATTERN.search(message)
        if byte_match:
            stats.bytes_transferred = max(
                stats.bytes_transferred,
                _parse_size_to_bytes(byte_match.group("value"), byte_match.group("unit")),
            )

        deleted_match = DELETED_COUNT_PATTERN.search(message)
        if deleted_match:
            stats.files_deleted = max(stats.files_deleted, int(deleted_match.group("count")))

        error_match = ERROR_COUNT_PATTERN.search(message)
        if error_match:
            stats.error_count = max(stats.error_count, int(error_match.group("count")))

        speed_matches = list(SPEED_PATTERN.finditer(message))
        if speed_matches:
            latest_speed = speed_matches[-1]
            stats.average_speed_bytes_per_second = max(
                stats.average_speed_bytes_per_second,
                _parse_size_to_bytes(latest_speed.group("value"), latest_speed.group("unit")),
            )

        if FILE_EVENT_PATTERN.search(message) and "Transferred:" not in message:
            per_file_events += 1

    if stats.files_transferred == 0 and per_file_events > 0:
        stats.files_transferred = per_file_events

    if stats.average_speed_bytes_per_second == 0 and stats.bytes_transferred > 0 and duration_seconds > 0:
        stats.average_speed_bytes_per_second = max(1, int(stats.bytes_transferred / duration_seconds))

    return stats


def _build_report(
    sync_pair: SyncPair,
    *,
    status: str,
    exit_code: int | None,
    duration_seconds: int,
    stdout: str,
    stderr: str,
    started_at: datetime,
    finished_at: datetime,
    stats: ParsedStats,
) -> str:
    summary = (
        f"Sync '{sync_pair.name}' wurde per {sync_pair.mode} von {sync_pair.source_path} nach "
        f"{sync_pair.destination_path} ausgeführt. Status: {status}. Exit-Code: {exit_code}. "
        f"Dateien bewegt: {stats.files_transferred}. Datenmenge: {_format_bytes(stats.bytes_transferred)}. "
        f"Durchschnittsgeschwindigkeit: {_format_speed(stats.average_speed_bytes_per_second)}. "
        f"Start: {started_at.astimezone().strftime('%d.%m.%Y %H:%M:%S')}. "
        f"Ende: {finished_at.astimezone().strftime('%d.%m.%Y %H:%M:%S')}. "
        f"Dauer: {duration_seconds}s."
    )
    if status == "success":
        if stats.files_transferred == 0 and stats.bytes_transferred == 0:
            return f"{summary} Keine Dateien mussten übertragen werden."
        return f"{summary} rclone hat den Lauf ohne Fehler beendet."

    error_summary = _extract_error_summary(stdout, stderr)
    stderr_excerpt = _tail_excerpt(stderr)
    stdout_excerpt = _tail_excerpt(stdout)
    return (
        f"{summary} Vermutete Ursache: {error_summary}\n\n"
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
    stats = _parse_stats(completed.stdout, completed.stderr, duration_seconds)
    status = "success" if completed.returncode == 0 else "error"
    error_summary = _extract_error_summary(completed.stdout, completed.stderr)
    short_log = (
        "Keine Änderungen erforderlich."
        if status == "success" and stats.files_transferred == 0 and stats.bytes_transferred == 0
        else (
            f"Sync erfolgreich: {stats.files_transferred} Dateien, {_format_bytes(stats.bytes_transferred)}, "
            f"{_format_speed(stats.average_speed_bytes_per_second)}, Dauer {duration_seconds}s."
            if status == "success"
            else f"rclone-Fehler: {error_summary}"
        )
    )
    report = _build_report(
        sync_pair,
        status=status,
        exit_code=completed.returncode,
        duration_seconds=duration_seconds,
        stdout=completed.stdout,
        stderr=completed.stderr,
        started_at=started_at,
        finished_at=finished_at,
        stats=stats,
    )

    with log_path.open("w", encoding="utf-8") as log_file:
        log_file.write(f"Command: {command_string}\n")
        log_file.write(f"Started at: {started_at.isoformat()}\n")
        log_file.write(f"Finished at: {finished_at.isoformat()}\n")
        log_file.write(f"Duration seconds: {duration_seconds}\n")
        log_file.write(f"Exit code: {completed.returncode}\n")
        log_file.write(f"Status: {status}\n")
        log_file.write(f"Files transferred: {stats.files_transferred}\n")
        log_file.write(f"Bytes transferred: {stats.bytes_transferred}\n")
        log_file.write(f"Average speed bytes/s: {stats.average_speed_bytes_per_second}\n")
        log_file.write(f"Deleted files: {stats.files_deleted}\n")
        log_file.write(f"Error count: {stats.error_count}\n")
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
        files_transferred=stats.files_transferred if executable else 1,
        files_deleted=stats.files_deleted,
        error_count=max(stats.error_count, 0 if status == "success" else 1),
        bytes_transferred=stats.bytes_transferred,
        average_speed_bytes_per_second=stats.average_speed_bytes_per_second,
    )
