from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LoginRequest(BaseModel):
    username: str
    password: str


class UserSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    username: str
    role: str
    is_active: bool
    created_at: datetime


class UserCreateRequest(BaseModel):
    username: str
    password: str
    role: str = "admin"
    is_active: bool = True


class UserUpdateRequest(BaseModel):
    role: str | None = None
    is_active: bool | None = None


class UserPasswordUpdateRequest(BaseModel):
    password: str
