from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SyncRunSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    sync_pair_id: str
    trigger_type: str
    status: str
    started_at: datetime
    finished_at: datetime
    duration_seconds: int
    files_transferred: int
    files_deleted: int
    error_count: int
    bytes_transferred: int
    average_speed_bytes_per_second: int
    exit_code: int | None
    short_log: str
    report: str
    full_log_path: str | None
    rclone_command: str
    created_at: datetime


class SyncRunProgressPoint(BaseModel):
    timestamp: datetime
    speed_bytes_per_second: int
    bytes_transferred: int
    percent_complete: float | None = None


class SyncRunProgressStatus(BaseModel):
    run_id: str
    status: str
    started_at: datetime
    updated_at: datetime
    finished_at: datetime | None = None
    bytes_transferred: int
    total_bytes: int | None = None
    files_transferred: int
    total_files: int | None = None
    average_speed_bytes_per_second: int
    eta_seconds: int | None = None
    estimated_completion_at: datetime | None = None
    percent_complete: float | None = None
    history: list[SyncRunProgressPoint]


class SyncRunCreate(BaseModel):
    trigger_type: str = "manual"
