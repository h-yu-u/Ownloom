from pydantic import BaseModel


class DownloadView(BaseModel):
    id: str
    repoId: str
    revision: str | None = None
    state: str
    pausedByUser: bool = False
    errorCode: str | None = None
    transferredBytes: int = 0
    modelId: str | None = None
