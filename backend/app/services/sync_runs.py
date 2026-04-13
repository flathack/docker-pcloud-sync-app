from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.sync_pair import SyncPair
from app.models.sync_run import SyncRun


def list_runs_for_sync_pair(db: Session, sync_pair_id: str) -> list[SyncRun]:
    statement = (
        select(SyncRun)
        .where(SyncRun.sync_pair_id == sync_pair_id)
        .order_by(SyncRun.started_at.desc())
    )
    return list(db.scalars(statement))


def start_demo_run(db: Session, sync_pair: SyncPair, trigger_type: str = "manual") -> SyncRun:
    started_at = datetime.now(timezone.utc)
    finished_at = datetime.now(timezone.utc)

    run = SyncRun(
        sync_pair_id=sync_pair.id,
        trigger_type=trigger_type,
        status="success",
        started_at=started_at,
        finished_at=finished_at,
        duration_seconds=1,
        files_transferred=12,
        files_deleted=0,
        error_count=0,
        bytes_transferred=1048576,
        short_log="Demo-Lauf erfolgreich abgeschlossen.",
    )

    sync_pair.status = "idle"
    sync_pair.last_status = "success"

    db.add(run)
    db.add(sync_pair)
    db.commit()
    db.refresh(run)
    return run
