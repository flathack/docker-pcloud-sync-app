from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text

from app.api.routes import router
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.sync_pair import SyncPair
from app.models.sync_run import SyncRun

app = FastAPI(title="PCloud Sync Docker App", version="0.1.0")

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


def ensure_dev_schema() -> None:
    inspector = inspect(engine)
    if "sync_runs" not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns("sync_runs")}
    required_columns = {
        "exit_code": "ALTER TABLE sync_runs ADD COLUMN exit_code INTEGER",
        "full_log_path": "ALTER TABLE sync_runs ADD COLUMN full_log_path TEXT",
        "rclone_command": "ALTER TABLE sync_runs ADD COLUMN rclone_command TEXT NOT NULL DEFAULT ''",
    }

    with engine.begin() as connection:
        for column_name, statement in required_columns.items():
            if column_name not in existing_columns:
                connection.execute(text(statement))


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_dev_schema()
    seed_sync_pairs()
