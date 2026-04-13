from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models.sync_pair import SyncPair

app = FastAPI(title="PCloud Sync Docker App", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


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


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    seed_sync_pairs()
