from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_ignore_empty=True)

    database_url: str = "postgresql+asyncpg://psclub:psclub@localhost:5432/psclub"
    bot_token: str | None = None
    owner_chat_id: int | None = None
    timezone: str = "Asia/Bishkek"


settings = Settings()
