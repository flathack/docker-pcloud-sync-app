from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.sync_pair import SyncPairCreate, SyncPairSummary, SyncPairUpdate
from app.services import sync_pairs as sync_pair_service

router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/sync-pairs", response_model=list[SyncPairSummary])
def list_sync_pairs(db: Session = Depends(get_db)) -> list[SyncPairSummary]:
    return sync_pair_service.list_sync_pairs(db)


@router.get("/sync-pairs/{sync_pair_id}", response_model=SyncPairSummary)
def get_sync_pair(sync_pair_id: str, db: Session = Depends(get_db)) -> SyncPairSummary:
    sync_pair = sync_pair_service.get_sync_pair(db, sync_pair_id)
    if sync_pair is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync-Paar nicht gefunden")

    return sync_pair


@router.post("/sync-pairs", response_model=SyncPairSummary, status_code=status.HTTP_201_CREATED)
def create_sync_pair(payload: SyncPairCreate, db: Session = Depends(get_db)) -> SyncPairSummary:
    return sync_pair_service.create_sync_pair(db, payload)


@router.put("/sync-pairs/{sync_pair_id}", response_model=SyncPairSummary)
def update_sync_pair(
    sync_pair_id: str,
    payload: SyncPairUpdate,
    db: Session = Depends(get_db),
) -> SyncPairSummary:
    sync_pair = sync_pair_service.get_sync_pair(db, sync_pair_id)
    if sync_pair is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync-Paar nicht gefunden")

    return sync_pair_service.update_sync_pair(db, sync_pair, payload)


@router.delete("/sync-pairs/{sync_pair_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sync_pair(sync_pair_id: str, db: Session = Depends(get_db)) -> Response:
    sync_pair = sync_pair_service.get_sync_pair(db, sync_pair_id)
    if sync_pair is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync-Paar nicht gefunden")

    sync_pair_service.delete_sync_pair(db, sync_pair)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
