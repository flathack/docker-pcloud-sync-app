from pydantic import BaseModel


class BrowserEntry(BaseModel):
    name: str
    path: str
    entry_type: str


class BrowserResponse(BaseModel):
    current_path: str
    parent_path: str | None
    backend_type: str
    entries: list[BrowserEntry]


class BrowserCreateDirectoryRequest(BaseModel):
    path: str | None = None
    backend_type: str = "local"
    directory_name: str
