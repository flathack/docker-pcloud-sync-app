from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import require_current_user
from app.db.session import get_db
from app.schemas.auth import LoginRequest, UserSummary
from app.schemas.sync_pair import SyncPairCreate, SyncPairSummary, SyncPairUpdate
from app.schemas.sync_run import SyncRunCreate, SyncRunSummary
from app.services import auth as auth_service
from app.services import sync_pairs as sync_pair_service
from app.services import sync_runs as sync_run_service

router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/auth/login", response_model=UserSummary)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> UserSummary:
    user = auth_service.authenticate_user(db, payload.username, payload.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login fehlgeschlagen")

    request.session["username"] = user.username
    return user


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request) -> Response:
    request.session.clear()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/auth/me", response_model=UserSummary)
def auth_me(current_user: UserSummary = Depends(require_current_user)) -> UserSummary:
    return current_user


@router.get("/sync-pairs", response_model=list[SyncPairSummary])
def list_sync_pairs(
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_current_user),
) -> list[SyncPairSummary]:
    return sync_pair_service.list_sync_pairs(db)


@router.get("/sync-pairs/{sync_pair_id}", response_model=SyncPairSummary)
def get_sync_pair(
    sync_pair_id: str,
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_current_user),
) -> SyncPairSummary:
    sync_pair = sync_pair_service.get_sync_pair(db, sync_pair_id)
    if sync_pair is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync-Paar nicht gefunden")

    return sync_pair


@router.post("/sync-pairs", response_model=SyncPairSummary, status_code=status.HTTP_201_CREATED)
def create_sync_pair(
    payload: SyncPairCreate,
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_current_user),
) -> SyncPairSummary:
    return sync_pair_service.create_sync_pair(db, payload)


@router.put("/sync-pairs/{sync_pair_id}", response_model=SyncPairSummary)
def update_sync_pair(
    sync_pair_id: str,
    payload: SyncPairUpdate,
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_current_user),
) -> SyncPairSummary:
    sync_pair = sync_pair_service.get_sync_pair(db, sync_pair_id)
    if sync_pair is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync-Paar nicht gefunden")

    return sync_pair_service.update_sync_pair(db, sync_pair, payload)


@router.delete("/sync-pairs/{sync_pair_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sync_pair(
    sync_pair_id: str,
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_current_user),
) -> Response:
    sync_pair = sync_pair_service.get_sync_pair(db, sync_pair_id)
    if sync_pair is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync-Paar nicht gefunden")

    sync_pair_service.delete_sync_pair(db, sync_pair)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sync-pairs/{sync_pair_id}/runs", response_model=list[SyncRunSummary])
def list_sync_pair_runs(
    sync_pair_id: str,
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_current_user),
) -> list[SyncRunSummary]:
    sync_pair = sync_pair_service.get_sync_pair(db, sync_pair_id)
    if sync_pair is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync-Paar nicht gefunden")

    return sync_run_service.list_runs_for_sync_pair(db, sync_pair_id)


@router.post(
    "/sync-pairs/{sync_pair_id}/run",
    response_model=SyncRunSummary,
    status_code=status.HTTP_201_CREATED,
)
def start_sync_pair_run(
    sync_pair_id: str,
    payload: SyncRunCreate,
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_current_user),
) -> SyncRunSummary:
    sync_pair = sync_pair_service.get_sync_pair(db, sync_pair_id)
    if sync_pair is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sync-Paar nicht gefunden")

    return sync_run_service.start_sync_run(db, sync_pair, trigger_type=payload.trigger_type)


@router.get("/runs/{run_id}", response_model=SyncRunSummary)
def get_run(
    run_id: str,
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_current_user),
) -> SyncRunSummary:
    run = sync_run_service.get_run(db, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run nicht gefunden")

    return run


@router.get("/runs/{run_id}/log")
def get_run_log(
    run_id: str,
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_current_user),
) -> dict[str, str]:
    run = sync_run_service.get_run(db, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run nicht gefunden")

    return {"log": sync_run_service.read_run_log(run)}
