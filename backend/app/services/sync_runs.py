from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.sync_pair import SyncPair
from app.models.sync_run import SyncRun
from app.runners.rclone_runner import run_sync_pair
from app.services import settings as settings_service
from app.services.sync_pairs import calculate_next_run


def list_runs(db: Session, limit: int = 50) -> list[SyncRun]:
    statement = select(SyncRun).order_by(SyncRun.started_at.desc()).limit(limit)
    return list(db.scalars(statement))


def list_runs_for_sync_pair(db: Session, sync_pair_id: str) -> list[SyncRun]:
    statement = (
        select(SyncRun)
        .where(SyncRun.sync_pair_id == sync_pair_id)
        .order_by(SyncRun.started_at.desc())
    )
    return list(db.scalars(statement))


def get_run(db: Session, run_id: str) -> SyncRun | None:
    return db.get(SyncRun, run_id)


def read_run_log(run: SyncRun) -> str:
    if not run.full_log_path:
        return ""

    log_path = Path(run.full_log_path)
    if not log_path.exists():
        return ""

    return log_path.read_text(encoding="utf-8")


def start_sync_run(db: Session, sync_pair: SyncPair, trigger_type: str = "manual") -> SyncRun:
    result = run_sync_pair(sync_pair)

    run = SyncRun(
        sync_pair_id=sync_pair.id,
        trigger_type=trigger_type,
        status=result.status,
        started_at=result.started_at,
        finished_at=result.finished_at,
        duration_seconds=result.duration_seconds,
        files_transferred=result.files_transferred,
        files_deleted=result.files_deleted,
        error_count=result.error_count,
        bytes_transferred=result.bytes_transferred,
        exit_code=result.exit_code,
        short_log=result.short_log,
        report=result.report,
        full_log_path=result.full_log_path,
        rclone_command=result.command,
    )

    sync_pair.status = "idle" if result.status == "success" else "error"
    sync_pair.last_status = result.status
    sync_pair.last_run_at = result.finished_at
    sync_pair.next_run_at = calculate_next_run(
        sync_pair.schedule_enabled,
        sync_pair.schedule_type,
        sync_pair.schedule_interval_minutes,
        sync_pair.schedule_time,
        sync_pair.schedule_weekday,
        now=result.finished_at,
    )

    db.add(run)
    db.add(sync_pair)
    db.commit()
    db.refresh(run)

    telegram_result = settings_service.send_sync_notification(
        sync_pair.name,
        run.status,
        run.short_log,
        run.report,
    )
    if not telegram_result.ok:
        run.report = f"{run.report}\n\nTelegram-Versand fehlgeschlagen: {telegram_result.detail}"
        db.add(run)
        db.commit()
        db.refresh(run)

    return run
