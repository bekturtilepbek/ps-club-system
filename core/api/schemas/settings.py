from pydantic import BaseModel


class PublicSettingsResponse(BaseModel):
    grace_minutes: int
    warn_minutes: int
    planned_open: str
    planned_close: str
