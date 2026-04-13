from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.sync_pair import SyncPair
from app.models.sync_run import SyncRun
from app.runners.rclone_runner import run_sync_pair


def list_runs_for_sync_pair(db: Session, sync_pair_id: str) -> list[SyncRun]:
    statement = (
        select(SyncRun)
        .where(SyncRun.sync_pair_id == sync_pair_id)
        .order_by(SyncRun.started_at.desc())
    )
    return list(db.scalars(statement))


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
        full_log_path=result.full_log_path,
        rclone_command=result.command,
    )

    sync_pair.status = "idle" if result.status == "success" else "error"
    sync_pair.last_status = result.status

    db.add(run)
    db.add(sync_pair)
    db.commit()
    db.refresh(run)
    return run
