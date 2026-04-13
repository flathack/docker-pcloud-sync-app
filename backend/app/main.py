import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from sqlalchemy import inspect, select, text

from app.api.routes import router
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.sync_pair import SyncPair
from app.models.sync_run import SyncRun
from app.models.user import User
from app.services.auth import create_admin_user
from app.services.sync_runs import start_sync_run

app = FastAPI(title="PCloud Sync Docker App", version="0.1.0")
_scheduler_started = False

app.add_middleware(
    SessionMiddleware,
    secret_key=os.getenv("APP_SECRET_KEY", "please-change-me"),
    same_site="lax",
    https_only=False,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

frontend_dist = Path(__file__).resolve().parents[2] / "frontend-dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")


def seed_sync_pairs() -> None:
    db = SessionLocal()
    try:
        if db.query(SyncPair).count() > 0:
            return

        db.add_all(
            [
                SyncPair(
                    name="NAS Fotos -> pCloud",
                    source_path="/mnt/nas/fotos",
                    destination_path="pcloud:/fotos",
                    mode="sync",
                    direction="push",
                    status="idle",
                    last_status="success",
                ),
                SyncPair(
                    name="Dokumente bidirektional",
                    source_path="/mnt/nas/dokumente",
                    destination_path="pcloud:/dokumente",
                    mode="bisync",
                    direction="bidirectional",
                    status="running",
                    last_status="success",
                ),
            ]
        )
        db.commit()
    finally:
        db.close()


def seed_admin_user() -> None:
    db = SessionLocal()
    try:
        username = os.getenv("ADMIN_USERNAME", "admin")
        password = os.getenv("ADMIN_PASSWORD", "change-me-now")
        if db.get(User, username) is None:
            create_admin_user(db, username, password)
    finally:
        db.close()


def ensure_dev_schema() -> None:
    inspector = inspect(engine)
    if "sync_runs" not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns("sync_runs")}
    required_columns = {
        "exit_code": "ALTER TABLE sync_runs ADD COLUMN exit_code INTEGER",
        "full_log_path": "ALTER TABLE sync_runs ADD COLUMN full_log_path TEXT",
        "rclone_command": "ALTER TABLE sync_runs ADD COLUMN rclone_command TEXT NOT NULL DEFAULT ''",
        "report": "ALTER TABLE sync_runs ADD COLUMN report TEXT NOT NULL DEFAULT ''",
        "average_speed_bytes_per_second": "ALTER TABLE sync_runs ADD COLUMN average_speed_bytes_per_second INTEGER NOT NULL DEFAULT 0",
    }

    pair_columns = set()
    if "sync_pairs" in inspector.get_table_names():
        pair_columns = {column["name"] for column in inspector.get_columns("sync_pairs")}

    required_pair_columns = {
        "schedule_enabled": "ALTER TABLE sync_pairs ADD COLUMN schedule_enabled BOOLEAN NOT NULL DEFAULT 0",
        "schedule_type": "ALTER TABLE sync_pairs ADD COLUMN schedule_type VARCHAR(50) NOT NULL DEFAULT 'daily'",
        "schedule_interval_minutes": "ALTER TABLE sync_pairs ADD COLUMN schedule_interval_minutes INTEGER NOT NULL DEFAULT 1440",
        "schedule_time": "ALTER TABLE sync_pairs ADD COLUMN schedule_time VARCHAR(5)",
        "schedule_weekday": "ALTER TABLE sync_pairs ADD COLUMN schedule_weekday INTEGER",
        "max_delete_count": "ALTER TABLE sync_pairs ADD COLUMN max_delete_count INTEGER NOT NULL DEFAULT 25",
        "backup_dir": "ALTER TABLE sync_pairs ADD COLUMN backup_dir TEXT",
        "next_run_at": "ALTER TABLE sync_pairs ADD COLUMN next_run_at DATETIME",
        "last_run_at": "ALTER TABLE sync_pairs ADD COLUMN last_run_at DATETIME",
    }

    with engine.begin() as connection:
        for column_name, statement in required_columns.items():
            if column_name not in existing_columns:
                connection.execute(text(statement))
        for column_name, statement in required_pair_columns.items():
            if column_name not in pair_columns:
                connection.execute(text(statement))


def scheduler_loop() -> None:
    while True:
        time.sleep(30)
        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            statement = select(SyncPair).where(
                SyncPair.enabled.is_(True),
                SyncPair.schedule_enabled.is_(True),
                SyncPair.next_run_at.is_not(None),
                SyncPair.next_run_at <= now,
            )
            due_pairs = list(db.scalars(statement))
            for pair in due_pairs:
                start_sync_run(db, pair, trigger_type="scheduled")
        except Exception:
            db.rollback()
        finally:
            db.close()


def start_scheduler() -> None:
    global _scheduler_started
    if _scheduler_started:
        return
    thread = threading.Thread(target=scheduler_loop, name="sync-scheduler", daemon=True)
    thread.start()
    _scheduler_started = True


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_dev_schema()
    seed_admin_user()
    seed_sync_pairs()
    start_scheduler()
