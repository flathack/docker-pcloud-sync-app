from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.sync_pair import SyncPair
from app.schemas.sync_pair import SyncPairCreate, SyncPairUpdate


def list_sync_pairs(db: Session) -> list[SyncPair]:
    statement = select(SyncPair).order_by(SyncPair.created_at.desc())
    return list(db.scalars(statement))


def get_sync_pair(db: Session, sync_pair_id: str) -> SyncPair | None:
    return db.get(SyncPair, sync_pair_id)


def create_sync_pair(db: Session, payload: SyncPairCreate) -> SyncPair:
    sync_pair = SyncPair(**payload.model_dump())
    db.add(sync_pair)
    db.commit()
    db.refresh(sync_pair)
    return sync_pair


def update_sync_pair(db: Session, sync_pair: SyncPair, payload: SyncPairUpdate) -> SyncPair:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(sync_pair, field, value)

    db.add(sync_pair)
    db.commit()
    db.refresh(sync_pair)
    return sync_pair


def delete_sync_pair(db: Session, sync_pair: SyncPair) -> None:
    db.delete(sync_pair)
    db.commit()
