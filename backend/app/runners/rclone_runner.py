import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.models.sync_pair import SyncPair

FILE_TRANSFERRED_PATTERN = re.compile(r"Transferred:\s*(?P<count>\d+)\s*/\s*(?P<total>\d+)", re.IGNORECASE)
BYTE_TRANSFERRED_PATTERN = re.compile(
    r"Transferred:\s*(?P<value>\d+(?:[.,]\d+)?)\s*(?P<unit>[KMGTPE]?i?B|B)\s*/\s*"
    r"(?P<total_value>\d+(?:[.,]\d+)?)\s*(?P<total_unit>[KMGTPE]?i?B|B)",
    re.IGNORECASE,
)
ERROR_COUNT_PATTERN = re.compile(r"Errors:\s*(?P<count>\d+)", re.IGNORECASE)
DELETED_COUNT_PATTERN = re.compile(r"Deleted:\s*(?P<count>\d+)", re.IGNORECASE)
SPEED_PATTERN = re.compile(r"(?P<value>\d+(?:[.,]\d+)?)\s*(?P<unit>[KMGTPE]?i?B|B)/s", re.IGNORECASE)
ETA_PATTERN = re.compile(r"ETA\s+(?P<eta>[0-9a-z]+)", re.IGNORECASE)
FILE_EVENT_PATTERN = re.compile(r"(Copied|Moved|Updated|Transferred|Renamed)", re.IGNORECASE)
REMOTE_PATH_PATTERN = re.compile(r"^[^/\\:]+:.+|^[^/\\:]+:$")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class RunnerProgress:
    timestamp: datetime
    bytes_transferred: int
    total_bytes: int | None
    files_transferred: int
    total_files: int | None
    average_speed_bytes_per_second: int
    eta_seconds: int | None
    estimated_completion_at: datetime | None
    percent_complete: float | None


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
    total_files: int | None = None
    files_deleted: int = 0
    error_count: int = 0
    bytes_transferred: int = 0
    total_bytes: int | None = None
    average_speed_bytes_per_second: int = 0
    eta_seconds: int | None = None
    percent_complete: float | None = None


@dataclass
class PreflightResult:
    ok: bool
    detail: str
    planned_deletions: int = 0


def _logs_dir() -> Path:
    log_dir = Path(os.getenv("APP_LOG_DIR", Path(__file__).resolve().parents[3] / "data" / "logs"))
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir


def _is_remote_path(path: str) -> bool:
    return bool(REMOTE_PATH_PATTERN.match(path))


def _rclone_binary() -> str:
    return os.getenv("RCLONE_BINARY", "rclone")


def _run_subprocess(command: list[str], timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, check=False, timeout=timeout)


def _remote_root(path: str) -> str:
    if ":" not in path:
        return path
    return f"{path.split(':', 1)[0]}:"


def _build_rclone_command(sync_pair: SyncPair) -> list[str]:
    command = [_rclone_binary(), sync_pair.mode, sync_pair.source_path, sync_pair.destination_path]

    global_flags = os.getenv("RCLONE_GLOBAL_FLAGS", "--use-json-log --log-level INFO --stats 10s")
    if global_flags.strip():
        filtered_flags = [flag for flag in shlex.split(global_flags) if flag != "--stats-one-line-json"]
        command.extend(filtered_flags)

    if sync_pair.backup_dir and sync_pair.mode == "sync":
        command.extend(["--backup-dir", sync_pair.backup_dir])

    if sync_pair.mode == "sync" and sync_pair.max_delete_count >= 0:
        command.extend(["--max-delete", str(sync_pair.max_delete_count)])

    return command


def _build_dry_run_command(command: list[str]) -> list[str]:
    return [*command, "--dry-run", "--stats", "0"]


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


def _extract_message_from_line(line: str) -> str:
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return line.strip()
    if not isinstance(payload, dict):
        return line.strip()
    return str(payload.get("msg") or payload.get("message") or line).strip()


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
    return "\n".join(lines[-max_lines:])


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


def _parse_eta_to_seconds(raw: str) -> int | None:
    if raw in {"0s", "-", ""}:
        return 0

    total = 0
    current = ""
    matched = False
    for char in raw:
        if char.isdigit():
            current += char
            continue
        if current and char in {"h", "m", "s", "d"}:
            value = int(current)
            matched = True
            if char == "d":
                total += value * 86400
            elif char == "h":
                total += value * 3600
            elif char == "m":
                total += value * 60
            else:
                total += value
            current = ""
    if matched:
        return total
    return None


def _update_stats_from_message(stats: ParsedStats, message: str) -> None:
    file_match = FILE_TRANSFERRED_PATTERN.search(message)
    if file_match:
        stats.files_transferred = max(stats.files_transferred, int(file_match.group("count")))
        stats.total_files = max(stats.total_files or 0, int(file_match.group("total")))

    byte_match = BYTE_TRANSFERRED_PATTERN.search(message)
    if byte_match:
        stats.bytes_transferred = max(
            stats.bytes_transferred,
            _parse_size_to_bytes(byte_match.group("value"), byte_match.group("unit")),
        )
        parsed_total = _parse_size_to_bytes(byte_match.group("total_value"), byte_match.group("total_unit"))
        stats.total_bytes = max(stats.total_bytes or 0, parsed_total)

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

    eta_match = ETA_PATTERN.search(message)
    if eta_match:
        stats.eta_seconds = _parse_eta_to_seconds(eta_match.group("eta"))

    if stats.total_bytes and stats.total_bytes > 0:
        stats.percent_complete = min(100.0, (stats.bytes_transferred / stats.total_bytes) * 100)
    elif stats.total_files and stats.total_files > 0:
        stats.percent_complete = min(100.0, (stats.files_transferred / stats.total_files) * 100)


def _parse_stats(stdout: str, stderr: str, duration_seconds: int) -> ParsedStats:
    stats = ParsedStats()
    combined_messages = _extract_messages(stdout) + _extract_messages(stderr)
    per_file_events = 0

    for message in combined_messages:
        _update_stats_from_message(stats, message)
        if FILE_EVENT_PATTERN.search(message) and "Transferred:" not in message:
            per_file_events += 1

    if stats.files_transferred == 0 and per_file_events > 0:
        stats.files_transferred = per_file_events

    if stats.average_speed_bytes_per_second == 0 and stats.bytes_transferred > 0 and duration_seconds > 0:
        stats.average_speed_bytes_per_second = max(1, int(stats.bytes_transferred / duration_seconds))

    return stats


def _progress_from_stats(stats: ParsedStats, *, timestamp: datetime) -> RunnerProgress:
    estimated_completion_at = None
    if stats.eta_seconds is not None:
        estimated_completion_at = timestamp + timedelta(seconds=stats.eta_seconds)

    return RunnerProgress(
        timestamp=timestamp,
        bytes_transferred=stats.bytes_transferred,
        total_bytes=stats.total_bytes,
        files_transferred=stats.files_transferred,
        total_files=stats.total_files,
        average_speed_bytes_per_second=stats.average_speed_bytes_per_second,
        eta_seconds=stats.eta_seconds,
        estimated_completion_at=estimated_completion_at,
        percent_complete=stats.percent_complete,
    )


def _check_local_source(path: str) -> str | None:
    source_path = Path(path)
    if not source_path.exists():
        return f"Quelle nicht gefunden: {path}"
    if not os.access(source_path, os.R_OK):
        return f"Quelle nicht lesbar: {path}"
    return None


def _check_local_destination(path: str) -> str | None:
    destination_path = Path(path)
    probe = destination_path if destination_path.exists() else destination_path.parent
    if not probe.exists():
        return f"Ziel oder Zielordner nicht gefunden: {path}"
    if not os.access(probe, os.W_OK):
        return f"Ziel nicht beschreibbar: {probe}"
    return None


def _check_remote_access(path: str, *, role: str, require_exact: bool = False) -> str | None:
    root = path if require_exact else _remote_root(path)
    try:
        result = _run_subprocess([_rclone_binary(), "lsf", root, "--max-depth", "1"], timeout=30)
    except subprocess.TimeoutExpired:
        return f"{role} nicht erreichbar: Timeout bei {root}"

    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "Unbekannter rclone-Fehler").strip()
        return f"{role} nicht erreichbar: {detail}"
    return None


def _run_preflight_checks(sync_pair: SyncPair, command: list[str]) -> PreflightResult:
    source_error = (
        _check_remote_access(sync_pair.source_path, role="Quelle", require_exact=True)
        if _is_remote_path(sync_pair.source_path)
        else _check_local_source(sync_pair.source_path)
    )
    if source_error:
        return PreflightResult(ok=False, detail=source_error)

    destination_error = (
        _check_remote_access(sync_pair.destination_path, role="Ziel")
        if _is_remote_path(sync_pair.destination_path)
        else _check_local_destination(sync_pair.destination_path)
    )
    if destination_error:
        return PreflightResult(ok=False, detail=destination_error)

    if sync_pair.backup_dir:
        backup_error = (
            _check_remote_access(sync_pair.backup_dir, role="Backup-Ziel")
            if _is_remote_path(sync_pair.backup_dir)
            else _check_local_destination(sync_pair.backup_dir)
        )
        if backup_error:
            return PreflightResult(ok=False, detail=backup_error)

    if sync_pair.mode not in {"sync", "bisync"}:
        return PreflightResult(ok=True, detail="Preflight erfolgreich. Keine Löschprüfung nötig.")

    try:
        dry_run = _run_subprocess(_build_dry_run_command(command), timeout=600)
    except subprocess.TimeoutExpired:
        return PreflightResult(ok=False, detail="Dry-Run zur Löschprüfung ist in ein Timeout gelaufen.")

    dry_stats = _parse_stats(dry_run.stdout, dry_run.stderr, 1)
    planned_deletions = dry_stats.files_deleted

    if dry_run.returncode != 0:
        detail = _extract_error_summary(dry_run.stdout, dry_run.stderr)
        return PreflightResult(ok=False, detail=f"Dry-Run fehlgeschlagen: {detail}")

    if planned_deletions > sync_pair.max_delete_count:
        return PreflightResult(
            ok=False,
            detail=(
                f"Schutzabbruch: Der Dry-Run hat {planned_deletions} geplante Löschungen erkannt. "
                f"Erlaubt sind maximal {sync_pair.max_delete_count}."
            ),
            planned_deletions=planned_deletions,
        )

    detail = (
        f"Preflight erfolgreich. Geplante Löschungen: {planned_deletions}. "
        f"Schutzgrenze: {sync_pair.max_delete_count}."
    )
    return PreflightResult(ok=True, detail=detail, planned_deletions=planned_deletions)


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
    return (
        f"{summary} Vermutete Ursache: {error_summary}\n\n"
        f"Letzte stderr-Zeilen:\n{_tail_excerpt(stderr)}\n\n"
        f"Letzte stdout-Zeilen:\n{_tail_excerpt(stdout)}"
    )


def _build_preflight_failure_result(
    sync_pair: SyncPair,
    *,
    command: list[str],
    started_at: datetime,
    detail: str,
) -> RunnerResult:
    finished_at = utc_now()
    duration_seconds = max(1, int((finished_at - started_at).total_seconds()))
    command_string = " ".join(shlex.quote(part) for part in command)
    log_path = _logs_dir() / f"{sync_pair.id}-{started_at.strftime('%Y%m%d%H%M%S')}.log"
    report = (
        f"Preflight für Sync '{sync_pair.name}' hat den Lauf vor dem Start abgebrochen. "
        f"Grund: {detail}"
    )
    with log_path.open("w", encoding="utf-8") as log_file:
        log_file.write(f"Command: {command_string}\n")
        log_file.write(f"Started at: {started_at.isoformat()}\n")
        log_file.write(f"Finished at: {finished_at.isoformat()}\n")
        log_file.write(f"Duration seconds: {duration_seconds}\n")
        log_file.write("Exit code: 2\n")
        log_file.write("Status: error\n")
        log_file.write("\n[report]\n")
        log_file.write(report)
        log_file.write("\n")
    return RunnerResult(
        status="error",
        exit_code=2,
        short_log=f"Preflight abgebrochen: {detail}",
        report=report,
        full_log_path=str(log_path),
        command=command_string,
        started_at=started_at,
        finished_at=finished_at,
        duration_seconds=duration_seconds,
        files_transferred=0,
        files_deleted=0,
        error_count=1,
        bytes_transferred=0,
        average_speed_bytes_per_second=0,
    )


def run_sync_pair(
    sync_pair: SyncPair,
    *,
    progress_callback: Callable[[RunnerProgress], None] | None = None,
    cancel_event: threading.Event | None = None,
) -> RunnerResult:
    started_at = utc_now()
    command = _build_rclone_command(sync_pair)
    executable = shutil.which(command[0])

    if executable is None:
        command = _fallback_command(sync_pair)
    else:
        preflight = _run_preflight_checks(sync_pair, command)
        if not preflight.ok:
            return _build_preflight_failure_result(
                sync_pair,
                command=command,
                started_at=started_at,
                detail=preflight.detail,
            )

    log_path = _logs_dir() / f"{sync_pair.id}-{started_at.strftime('%Y%m%d%H%M%S')}.log"
    command_string = " ".join(shlex.quote(part) for part in command)

    stdout_lines: list[str] = []
    stderr_text = ""
    stats = ParsedStats()
    per_file_events = 0

    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert process.stdout is not None
        cancelled = False
        for raw_line in process.stdout:
            if cancel_event is not None and cancel_event.is_set():
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                cancelled = True
                break
            stdout_lines.append(raw_line)
            message = _extract_message_from_line(raw_line)
            _update_stats_from_message(stats, message)
            if FILE_EVENT_PATTERN.search(message) and "Transferred:" not in message:
                per_file_events += 1
                if stats.files_transferred == 0:
                    stats.files_transferred = per_file_events
            if progress_callback is not None and executable is not None:
                progress_callback(_progress_from_stats(stats, timestamp=utc_now()))
        if cancelled:
            return_code = -2
            stderr_text = "Sync-Lauf wurde vom Benutzer abgebrochen."
        else:
            return_code = process.wait(timeout=300)
    except subprocess.TimeoutExpired:
        process.kill()
        return_code = 124
        stderr_text = "Process timed out after 300 seconds."
    except Exception as exc:
        return_code = 1
        stderr_text = f"Interner Runner-Fehler: {exc}"

    completed_stdout = "".join(stdout_lines)
    completed_stderr = stderr_text

    finished_at = utc_now()
    duration_seconds = max(1, int((finished_at - started_at).total_seconds()))
    final_stats = _parse_stats(completed_stdout, completed_stderr, duration_seconds)
    if final_stats.files_transferred == 0 and per_file_events > 0:
        final_stats.files_transferred = per_file_events
    if final_stats.average_speed_bytes_per_second == 0 and stats.average_speed_bytes_per_second > 0:
        final_stats.average_speed_bytes_per_second = stats.average_speed_bytes_per_second
    if final_stats.total_bytes is None:
        final_stats.total_bytes = stats.total_bytes
    if final_stats.total_files is None:
        final_stats.total_files = stats.total_files
    if final_stats.eta_seconds is None:
        final_stats.eta_seconds = 0 if return_code == 0 else stats.eta_seconds
    if return_code == 0 and final_stats.percent_complete is None and (
        final_stats.bytes_transferred > 0 or final_stats.files_transferred > 0
    ):
        final_stats.percent_complete = 100.0

    if progress_callback is not None and executable is not None:
        progress_callback(
            RunnerProgress(
                timestamp=finished_at,
                bytes_transferred=final_stats.bytes_transferred,
                total_bytes=final_stats.total_bytes or final_stats.bytes_transferred or None,
                files_transferred=final_stats.files_transferred,
                total_files=final_stats.total_files or final_stats.files_transferred or None,
                average_speed_bytes_per_second=final_stats.average_speed_bytes_per_second,
                eta_seconds=0 if return_code == 0 else final_stats.eta_seconds,
                estimated_completion_at=finished_at if return_code == 0 else None,
                percent_complete=100.0
                if return_code == 0 and (final_stats.bytes_transferred > 0 or final_stats.files_transferred > 0)
                else final_stats.percent_complete,
            )
        )

    status = "cancelled" if return_code == -2 else ("success" if return_code == 0 else "error")
    error_summary = _extract_error_summary(completed_stdout, completed_stderr)
    short_log = (
        "Sync-Lauf wurde vom Benutzer abgebrochen."
        if status == "cancelled"
        else "Keine Änderungen erforderlich."
        if status == "success" and final_stats.files_transferred == 0 and final_stats.bytes_transferred == 0
        else (
            f"Sync erfolgreich: {final_stats.files_transferred} Dateien, {_format_bytes(final_stats.bytes_transferred)}, "
            f"{_format_speed(final_stats.average_speed_bytes_per_second)}, Dauer {duration_seconds}s."
            if status == "success"
            else f"rclone-Fehler: {error_summary}"
        )
    )
    report = _build_report(
        sync_pair,
        status=status,
        exit_code=return_code,
        duration_seconds=duration_seconds,
        stdout=completed_stdout,
        stderr=completed_stderr,
        started_at=started_at,
        finished_at=finished_at,
        stats=final_stats,
    )

    with log_path.open("w", encoding="utf-8") as log_file:
        log_file.write(f"Command: {command_string}\n")
        log_file.write(f"Started at: {started_at.isoformat()}\n")
        log_file.write(f"Finished at: {finished_at.isoformat()}\n")
        log_file.write(f"Duration seconds: {duration_seconds}\n")
        log_file.write(f"Exit code: {return_code}\n")
        log_file.write(f"Status: {status}\n")
        log_file.write(f"Files transferred: {final_stats.files_transferred}\n")
        log_file.write(f"Bytes transferred: {final_stats.bytes_transferred}\n")
        log_file.write(f"Average speed bytes/s: {final_stats.average_speed_bytes_per_second}\n")
        log_file.write(f"Deleted files: {final_stats.files_deleted}\n")
        log_file.write(f"Error count: {final_stats.error_count}\n")
        if status == "error":
            log_file.write(f"Error summary: {error_summary}\n")
        log_file.write("\n[report]\n")
        log_file.write(report)
        if not report.endswith("\n"):
            log_file.write("\n")
        log_file.write("\n[stdout]\n")
        if completed_stdout:
            log_file.write(completed_stdout)
            if not completed_stdout.endswith("\n"):
                log_file.write("\n")
        else:
            log_file.write("(keine Ausgabe)\n")
        log_file.write("\n[stderr]\n")
        if completed_stderr:
            log_file.write(completed_stderr)
            if not completed_stderr.endswith("\n"):
                log_file.write("\n")
        else:
            log_file.write("(keine Ausgabe)\n")

    return RunnerResult(
        status=status,
        exit_code=return_code,
        short_log=short_log,
        report=report,
        full_log_path=str(log_path),
        command=command_string,
        started_at=started_at,
        finished_at=finished_at,
        duration_seconds=duration_seconds,
        files_transferred=final_stats.files_transferred if executable else 1,
        files_deleted=final_stats.files_deleted,
        error_count=max(final_stats.error_count, 0 if status == "success" else 1),
        bytes_transferred=final_stats.bytes_transferred,
        average_speed_bytes_per_second=final_stats.average_speed_bytes_per_second,
    )
