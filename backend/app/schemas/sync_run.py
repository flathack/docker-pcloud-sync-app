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


class SyncRunCreate(BaseModel):
    trigger_type: str = "manual"
