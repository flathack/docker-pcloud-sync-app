from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import require_admin_user, require_current_user
from app.db.session import get_db
from app.schemas.auth import (
    LoginRequest,
    UserCreateRequest,
    UserPasswordUpdateRequest,
    UserSummary,
    UserUpdateRequest,
)
from app.schemas.browser import BrowserCreateDirectoryRequest, BrowserResponse
from app.schemas.settings import RcloneConfigStatus, RcloneConfigTestRequest, RcloneConfigTestResult
from app.schemas.settings import (
    TelegramSettingsStatus,
    TelegramSettingsUpdateRequest,
    TelegramTestRequest,
    TelegramTestResult,
)
from app.schemas.sync_pair import SyncPairCreate, SyncPairSummary, SyncPairUpdate
from app.schemas.sync_run import SyncRunCreate, SyncRunProgressStatus, SyncRunSummary
from app.services import auth as auth_service
from app.services import browser as browser_service
from app.services import settings as settings_service
from app.services import sync_pairs as sync_pair_service
from app.services import sync_runs as sync_run_service

router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/browser", response_model=BrowserResponse)
def browse(
    path: str | None = None,
    backend_type: str = "local",
    current_user: UserSummary = Depends(require_current_user),
) -> BrowserResponse:
    try:
        return browser_service.browse(path, backend_type=backend_type)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/browser/directories", response_model=BrowserResponse, status_code=status.HTTP_201_CREATED)
def create_browser_directory(
    payload: BrowserCreateDirectoryRequest,
    current_user: UserSummary = Depends(require_current_user),
) -> BrowserResponse:
    try:
        return browser_service.create_directory(
            payload.path,
            payload.directory_name,
            backend_type=payload.backend_type,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


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


@router.get("/users", response_model=list[UserSummary])
def list_users(
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_admin_user),
) -> list[UserSummary]:
    return auth_service.list_users(db)


@router.post("/users", response_model=UserSummary, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreateRequest,
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_admin_user),
) -> UserSummary:
    try:
        return auth_service.create_user(
            db,
            payload.username,
            payload.password,
            role=payload.role,
            is_active=payload.is_active,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.put("/users/{username}", response_model=UserSummary)
def update_user(
    username: str,
    payload: UserUpdateRequest,
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_admin_user),
) -> UserSummary:
    user = auth_service.get_user_by_username(db, username)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Benutzer nicht gefunden")
    if current_user.username == username and payload.is_active is False:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Eigener Benutzer kann nicht deaktiviert werden")
    return auth_service.update_user(db, user, role=payload.role, is_active=payload.is_active)


@router.put("/users/{username}/password", response_model=UserSummary)
def update_user_password(
    username: str,
    payload: UserPasswordUpdateRequest,
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_admin_user),
) -> UserSummary:
    user = auth_service.get_user_by_username(db, username)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Benutzer nicht gefunden")
    try:
        return auth_service.update_user_password(db, user, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete("/users/{username}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    username: str,
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_admin_user),
) -> Response:
    user = auth_service.get_user_by_username(db, username)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Benutzer nicht gefunden")
    if current_user.username == username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Eigener Benutzer kann nicht gelöscht werden")
    auth_service.delete_user(db, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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


@router.get("/runs", response_model=list[SyncRunSummary])
def list_runs(
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_current_user),
) -> list[SyncRunSummary]:
    return sync_run_service.list_runs(db, limit=min(max(limit, 1), 250))


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

    return sync_run_service.start_sync_run_async(db, sync_pair, trigger_type=payload.trigger_type)


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


@router.get("/runs/{run_id}/progress", response_model=SyncRunProgressStatus)
def get_run_progress(
    run_id: str,
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_current_user),
) -> SyncRunProgressStatus:
    run = sync_run_service.get_run(db, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run nicht gefunden")

    progress = sync_run_service.get_run_progress(run_id)
    if progress is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Für diesen Run sind keine Live-Daten verfügbar")
    return progress


@router.post("/runs/{run_id}/cancel", response_model=SyncRunSummary)
def cancel_run(
    run_id: str,
    db: Session = Depends(get_db),
    current_user: UserSummary = Depends(require_current_user),
) -> SyncRunSummary:
    run = sync_run_service.get_run(db, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run nicht gefunden")
    if run.status != "running":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nur laufende Runs können abgebrochen werden")
    try:
        return sync_run_service.cancel_run(db, run)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/settings/rclone/status", response_model=RcloneConfigStatus)
def get_rclone_status(
    current_user: UserSummary = Depends(require_current_user),
) -> RcloneConfigStatus:
    return settings_service.get_rclone_config_status()


@router.post("/settings/rclone/upload", response_model=RcloneConfigStatus)
async def upload_rclone_config(
    file: UploadFile = File(...),
    current_user: UserSummary = Depends(require_current_user),
) -> RcloneConfigStatus:
    try:
        content = await file.read()
        return settings_service.save_rclone_config(file.filename or "rclone.conf", content)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/settings/rclone/test", response_model=RcloneConfigTestResult)
def test_rclone_config(
    payload: RcloneConfigTestRequest,
    current_user: UserSummary = Depends(require_current_user),
) -> RcloneConfigTestResult:
    return settings_service.test_rclone_remote(payload.remote_name)


@router.get("/settings/telegram", response_model=TelegramSettingsStatus)
def get_telegram_settings(
    current_user: UserSummary = Depends(require_current_user),
) -> TelegramSettingsStatus:
    return settings_service.get_telegram_settings_status()


@router.put("/settings/telegram", response_model=TelegramSettingsStatus)
def save_telegram_settings(
    payload: TelegramSettingsUpdateRequest,
    current_user: UserSummary = Depends(require_current_user),
) -> TelegramSettingsStatus:
    return settings_service.save_telegram_settings(
        enabled=payload.enabled,
        bot_token=payload.bot_token,
        chat_id=payload.chat_id,
        notify_on_success=payload.notify_on_success,
        notify_on_error=payload.notify_on_error,
    )


@router.post("/settings/test-telegram", response_model=TelegramTestResult)
def test_telegram_settings(
    payload: TelegramTestRequest,
    current_user: UserSummary = Depends(require_current_user),
) -> TelegramTestResult:
    return settings_service.test_telegram(payload.message)
