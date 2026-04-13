from pydantic import BaseModel


class RcloneConfigStatus(BaseModel):
    exists: bool
    config_path: str
    file_size: int | None = None
    updated_at: str | None = None
    remotes: list[str]
    is_valid: bool
    detail: str


class RcloneConfigTestRequest(BaseModel):
    remote_name: str | None = None


class RcloneConfigTestResult(BaseModel):
    ok: bool
    remote_name: str | None = None
    detail: str
