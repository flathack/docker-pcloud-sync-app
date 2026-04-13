import threading
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.sync_pair import SyncPair
from app.models.sync_run import SyncRun
from app.runners.rclone_runner import run_sync_pair
from app.services import settings as settings_service
from app.services.sync_pairs import calculate_next_run


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def list_runs(db: Session, limit: int = 50) -> list[SyncRun]:
    statement = (
        select(SyncRun)
        .where(_listable_run_filter())
        .order_by(SyncRun.started_at.desc())
        .limit(limit)
    )
    return list(db.scalars(statement))


def list_runs_for_sync_pair(db: Session, sync_pair_id: str) -> list[SyncRun]:
    statement = (
        select(SyncRun)
        .where(
            SyncRun.sync_pair_id == sync_pair_id,
            _listable_run_filter(),
        )
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


def _apply_run_result(db: Session, sync_pair: SyncPair, run: SyncRun) -> None:
    if run.status == "success" and not _should_keep_run(run):
        return

    telegram_result = settings_service.send_sync_notification(
        sync_pair.name,
        run.status,
        run.short_log,
        run.report,
        files_transferred=run.files_transferred,
        bytes_transferred=run.bytes_transferred,
        duration_seconds=run.duration_seconds,
        average_speed_bytes_per_second=run.average_speed_bytes_per_second,
        started_at=run.started_at,
        finished_at=run.finished_at,
    )
    if not telegram_result.ok:
        run.report = f"{run.report}\n\nTelegram-Versand fehlgeschlagen: {telegram_result.detail}"
        db.add(run)
        db.commit()
        db.refresh(run)


def _execute_sync_run_in_background(sync_pair_id: str, run_id: str) -> None:
    db = SessionLocal()
    try:
        sync_pair = db.get(SyncPair, sync_pair_id)
        run = db.get(SyncRun, run_id)
        if sync_pair is None or run is None:
            return

        result = run_sync_pair(sync_pair)

        run.status = result.status
        run.started_at = result.started_at
        run.finished_at = result.finished_at
        run.duration_seconds = result.duration_seconds
        run.files_transferred = result.files_transferred
        run.files_deleted = result.files_deleted
        run.error_count = result.error_count
        run.bytes_transferred = result.bytes_transferred
        run.average_speed_bytes_per_second = result.average_speed_bytes_per_second
        run.exit_code = result.exit_code
        run.short_log = result.short_log
        run.report = result.report
        run.full_log_path = result.full_log_path
        run.rclone_command = result.command

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
        should_keep_run = run.status == "error" or _should_keep_run(run)
        if should_keep_run:
            db.refresh(run)
            _apply_run_result(db, sync_pair, run)
        else:
            db.delete(run)
            db.commit()
    except Exception as exc:
        sync_pair = db.get(SyncPair, sync_pair_id)
        run = db.get(SyncRun, run_id)
        if sync_pair is not None:
            sync_pair.status = "error"
            sync_pair.last_status = "error"
            db.add(sync_pair)
        if run is not None:
            finished_at = utc_now()
            run.status = "error"
            run.finished_at = finished_at
            run.duration_seconds = max(1, int((finished_at - run.started_at).total_seconds()))
            run.error_count = 1
            run.exit_code = -1
            run.short_log = f"Interner Fehler beim Sync-Lauf: {exc}"
            run.report = f"Der Hintergrundlauf ist mit einem internen Fehler abgebrochen: {exc}"
            db.add(run)
        db.commit()
    finally:
        db.close()


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
        average_speed_bytes_per_second=result.average_speed_bytes_per_second,
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
    should_keep_run = run.status == "error" or _should_keep_run(run)
    if should_keep_run:
        db.refresh(run)
        _apply_run_result(db, sync_pair, run)
        return run

    db.delete(run)
    db.commit()
    return SyncRun(
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
        average_speed_bytes_per_second=result.average_speed_bytes_per_second,
        exit_code=result.exit_code,
        short_log=result.short_log,
        report=result.report,
        full_log_path=result.full_log_path,
        rclone_command=result.command,
    )


def start_sync_run_async(db: Session, sync_pair: SyncPair, trigger_type: str = "manual") -> SyncRun:
    started_at = utc_now()
    run = SyncRun(
        sync_pair_id=sync_pair.id,
        trigger_type=trigger_type,
        status="running",
        started_at=started_at,
        finished_at=started_at,
        duration_seconds=0,
        files_transferred=0,
        files_deleted=0,
        error_count=0,
        bytes_transferred=0,
        average_speed_bytes_per_second=0,
        exit_code=None,
        short_log="Sync-Lauf wurde gestartet.",
        report="Der Sync-Lauf läuft im Hintergrund. Der Bericht wird nach Abschluss aktualisiert.",
        full_log_path=None,
        rclone_command="",
    )

    sync_pair.status = "running"
    sync_pair.last_status = "running"

    db.add(run)
    db.add(sync_pair)
    db.commit()
    db.refresh(run)

    worker = threading.Thread(
        target=_execute_sync_run_in_background,
        args=(sync_pair.id, run.id),
        name=f"sync-run-{run.id}",
        daemon=True,
    )
    worker.start()
    return run


def _should_keep_run(run: SyncRun) -> bool:
    return run.files_transferred > 0 or run.bytes_transferred > 0


def _listable_run_filter():
    return or_(
        SyncRun.status.in_(("running", "error")),
        SyncRun.files_transferred > 0,
        SyncRun.bytes_transferred > 0,
    )
