import os
import re
import subprocess
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, parse, request

from app.schemas.settings import (
    RcloneConfigStatus,
    RcloneConfigTestResult,
    TelegramSettingsStatus,
    TelegramTestResult,
)

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


def _config_root() -> Path:
    configured = os.getenv("APP_CONFIG_DIR", "./data/config")
    path = Path(configured)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parents[3] / configured).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _telegram_settings_path() -> Path:
    return _config_root() / "telegram.json"


def _default_telegram_settings() -> dict[str, object]:
    return {
        "enabled": os.getenv("TELEGRAM_ENABLED", "false").lower() == "true",
        "bot_token": os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
        "chat_id": os.getenv("TELEGRAM_CHAT_ID", "").strip(),
        "notify_on_success": os.getenv("TELEGRAM_NOTIFY_ON_SUCCESS", "false").lower() == "true",
        "notify_on_error": os.getenv("TELEGRAM_NOTIFY_ON_ERROR", "true").lower() == "true",
    }


def _load_telegram_settings() -> dict[str, object]:
    settings = _default_telegram_settings()
    path = _telegram_settings_path()
    if path.exists():
        content = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(content, dict):
            settings.update(content)
    settings["bot_token"] = str(settings.get("bot_token", "") or "").strip()
    settings["chat_id"] = str(settings.get("chat_id", "") or "").strip()
    settings["enabled"] = bool(settings.get("enabled", False))
    settings["notify_on_success"] = bool(settings.get("notify_on_success", False))
    settings["notify_on_error"] = bool(settings.get("notify_on_error", True))
    return settings


def _save_telegram_settings(settings: dict[str, object]) -> None:
    path = _telegram_settings_path()
    path.write_text(json.dumps(settings, indent=2, ensure_ascii=True), encoding="utf-8")


def _telegram_status_from_settings(settings: dict[str, object]) -> TelegramSettingsStatus:
    enabled = bool(settings.get("enabled", False))
    bot_token = str(settings.get("bot_token", "") or "")
    chat_id = str(settings.get("chat_id", "") or "") or None
    configured = bool(bot_token and chat_id)
    if not configured:
        detail = "Telegram ist noch nicht vollständig konfiguriert."
    elif enabled:
        detail = "Telegram-Benachrichtigungen sind aktiv."
    else:
        detail = "Telegram ist konfiguriert, aber derzeit deaktiviert."
    return TelegramSettingsStatus(
        enabled=enabled,
        bot_token_configured=configured,
        chat_id=chat_id,
        notify_on_success=bool(settings.get("notify_on_success", False)),
        notify_on_error=bool(settings.get("notify_on_error", True)),
        detail=detail,
    )


def _send_telegram_message(bot_token: str, chat_id: str, message: str) -> TelegramTestResult:
    payload = parse.urlencode({"chat_id": chat_id, "text": message}).encode("utf-8")
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    req = request.Request(url, data=payload, method="POST")
    try:
        with request.urlopen(req, timeout=20) as response:
            raw = response.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return TelegramTestResult(ok=False, detail=f"Telegram-API-Fehler: {detail}")
    except error.URLError as exc:
        return TelegramTestResult(ok=False, detail=f"Telegram nicht erreichbar: {exc.reason}")

    try:
        response_json = json.loads(raw)
    except json.JSONDecodeError:
        return TelegramTestResult(ok=False, detail=f"Unerwartete Telegram-Antwort: {raw[:300]}")

    if not response_json.get("ok"):
        return TelegramTestResult(ok=False, detail=f"Telegram meldet Fehler: {response_json}")
    return TelegramTestResult(ok=True, detail="Telegram-Nachricht erfolgreich gesendet.")


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


def get_telegram_settings_status() -> TelegramSettingsStatus:
    return _telegram_status_from_settings(_load_telegram_settings())


def save_telegram_settings(
    *,
    enabled: bool,
    bot_token: str | None,
    chat_id: str | None,
    notify_on_success: bool,
    notify_on_error: bool,
) -> TelegramSettingsStatus:
    existing = _load_telegram_settings()
    normalized_bot_token = (bot_token or "").strip() or str(existing.get("bot_token", "") or "").strip()
    settings = {
        "enabled": enabled,
        "bot_token": normalized_bot_token,
        "chat_id": (chat_id or "").strip(),
        "notify_on_success": notify_on_success,
        "notify_on_error": notify_on_error,
    }
    _save_telegram_settings(settings)
    return _telegram_status_from_settings(settings)


def test_telegram(message: str | None = None) -> TelegramTestResult:
    settings = _load_telegram_settings()
    bot_token = str(settings.get("bot_token", "") or "")
    chat_id = str(settings.get("chat_id", "") or "")
    if not bot_token or not chat_id:
        return TelegramTestResult(ok=False, detail="Bitte zuerst Bot-Token und Chat-ID hinterlegen.")
    text = message or "Testnachricht aus pcloud-sync-app. Telegram ist erreichbar."
    return _send_telegram_message(bot_token, chat_id, text)


def send_sync_notification(
    sync_pair_name: str,
    run_status: str,
    short_log: str,
    report: str,
    *,
    files_transferred: int,
    bytes_transferred: int,
    duration_seconds: int,
    average_speed_bytes_per_second: int,
    started_at: datetime,
    finished_at: datetime,
) -> TelegramTestResult:
    settings = _load_telegram_settings()
    if not bool(settings.get("enabled", False)):
        return TelegramTestResult(ok=True, detail="Telegram ist deaktiviert.")
    if files_transferred <= 0 and bytes_transferred <= 0:
        return TelegramTestResult(ok=True, detail="Keine Telegram-Nachricht nötig, da keine Dateien bewegt wurden.")
    if run_status == "success" and not bool(settings.get("notify_on_success", False)):
        return TelegramTestResult(ok=True, detail="Erfolgsbenachrichtigungen sind deaktiviert.")
    if run_status != "success" and not bool(settings.get("notify_on_error", True)):
        return TelegramTestResult(ok=True, detail="Fehlerbenachrichtigungen sind deaktiviert.")

    bot_token = str(settings.get("bot_token", "") or "")
    chat_id = str(settings.get("chat_id", "") or "")
    if not bot_token or not chat_id:
        return TelegramTestResult(ok=False, detail="Telegram ist aktiviert, aber nicht vollständig konfiguriert.")

    message = (
        f"Sync: {sync_pair_name}\n"
        f"Status: {run_status}\n"
        f"Dateien bewegt: {files_transferred}\n"
        f"Datenmenge: {_format_bytes(bytes_transferred)}\n"
        f"Dauer: {duration_seconds}s\n"
        f"Ø Geschwindigkeit: {_format_speed(average_speed_bytes_per_second)}\n"
        f"Start: {started_at.astimezone().strftime('%d.%m.%Y %H:%M:%S')}\n"
        f"Ende: {finished_at.astimezone().strftime('%d.%m.%Y %H:%M:%S')}\n"
        f"Zusammenfassung: {short_log}\n\n"
        f"{report[:2500]}"
    )
    return _send_telegram_message(bot_token, chat_id, message)
