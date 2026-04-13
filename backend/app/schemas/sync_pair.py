from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SyncPairSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    source_path: str
    destination_path: str
    mode: str
    direction: str
    status: str
    last_status: str
    enabled: bool
    created_at: datetime
    updated_at: datetime


class SyncPairCreate(BaseModel):
    name: str
    source_path: str
    destination_path: str
    mode: str
    direction: str
    status: str = "idle"
    last_status: str = "never"
    enabled: bool = True


class SyncPairUpdate(BaseModel):
    name: str | None = None
    source_path: str | None = None
    destination_path: str | None = None
    mode: str | None = None
    direction: str | None = None
    status: str | None = None
    last_status: str | None = None
    enabled: bool | None = None
