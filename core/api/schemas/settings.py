from pydantic import BaseModel


class PublicSettingsResponse(BaseModel):
    grace_minutes: int
    warn_minutes: int
