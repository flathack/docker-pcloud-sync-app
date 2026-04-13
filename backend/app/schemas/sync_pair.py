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
    schedule_enabled: bool
    schedule_type: str
    schedule_interval_minutes: int
    schedule_time: str | None
    schedule_weekday: int | None
    next_run_at: datetime | None
    last_run_at: datetime | None
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
    schedule_enabled: bool = False
    schedule_type: str = "daily"
    schedule_interval_minutes: int = 1440
    schedule_time: str | None = None
    schedule_weekday: int | None = None


class SyncPairUpdate(BaseModel):
    name: str | None = None
    source_path: str | None = None
    destination_path: str | None = None
    mode: str | None = None
    direction: str | None = None
    status: str | None = None
    last_status: str | None = None
    enabled: bool | None = None
    schedule_enabled: bool | None = None
    schedule_type: str | None = None
    schedule_interval_minutes: int | None = None
    schedule_time: str | None = None
    schedule_weekday: int | None = None
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None
