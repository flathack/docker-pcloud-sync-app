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


class TelegramSettingsStatus(BaseModel):
    enabled: bool
    bot_token_configured: bool
    chat_id: str | None = None
    notify_on_success: bool
    notify_on_error: bool
    detail: str


class TelegramSettingsUpdateRequest(BaseModel):
    enabled: bool = False
    bot_token: str | None = None
    chat_id: str | None = None
    notify_on_success: bool = False
    notify_on_error: bool = True


class TelegramTestRequest(BaseModel):
    message: str | None = None


class TelegramTestResult(BaseModel):
    ok: bool
    detail: str
