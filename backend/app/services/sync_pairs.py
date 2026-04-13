from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.sync_pair import SyncPair
from app.schemas.sync_pair import SyncPairCreate, SyncPairUpdate


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def calculate_next_run(
    schedule_enabled: bool,
    schedule_type: str,
    schedule_interval_minutes: int,
    schedule_time: str | None,
    schedule_weekday: int | None,
    *,
    now: datetime | None = None,
) -> datetime | None:
    if not schedule_enabled:
        return None

    now = now or utc_now()
    interval = max(5, schedule_interval_minutes)
    schedule_type = schedule_type.lower()

    if schedule_type == "interval":
        return now + timedelta(minutes=interval)

    hour = 0
    minute = 0
    if schedule_time:
        parts = schedule_time.split(":", 1)
        if len(parts) == 2:
            hour = max(0, min(23, int(parts[0])))
            minute = max(0, min(59, int(parts[1])))

    candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if schedule_type == "daily":
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate

    if schedule_type == "weekly":
        weekday = 0 if schedule_weekday is None else max(0, min(6, schedule_weekday))
        days_ahead = (weekday - candidate.weekday()) % 7
        candidate += timedelta(days=days_ahead)
        if candidate <= now:
            candidate += timedelta(days=7)
        return candidate

    if schedule_type == "hourly":
        candidate = now.replace(second=0, microsecond=0) + timedelta(hours=1)
        return candidate.replace(minute=minute)

    return now + timedelta(minutes=interval)


def list_sync_pairs(db: Session) -> list[SyncPair]:
    statement = select(SyncPair).order_by(SyncPair.created_at.desc())
    return list(db.scalars(statement))


def get_sync_pair(db: Session, sync_pair_id: str) -> SyncPair | None:
    return db.get(SyncPair, sync_pair_id)


def create_sync_pair(db: Session, payload: SyncPairCreate) -> SyncPair:
    values = payload.model_dump()
    values["next_run_at"] = calculate_next_run(
        values["schedule_enabled"],
        values["schedule_type"],
        values["schedule_interval_minutes"],
        values["schedule_time"],
        values["schedule_weekday"],
    )
    sync_pair = SyncPair(**values)
    db.add(sync_pair)
    db.commit()
    db.refresh(sync_pair)
    return sync_pair


def update_sync_pair(db: Session, sync_pair: SyncPair, payload: SyncPairUpdate) -> SyncPair:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(sync_pair, field, value)

    sync_pair.next_run_at = calculate_next_run(
        sync_pair.schedule_enabled,
        sync_pair.schedule_type,
        sync_pair.schedule_interval_minutes,
        sync_pair.schedule_time,
        sync_pair.schedule_weekday,
    )

    db.add(sync_pair)
    db.commit()
    db.refresh(sync_pair)
    return sync_pair


def delete_sync_pair(db: Session, sync_pair: SyncPair) -> None:
    db.delete(sync_pair)
    db.commit()
