from pydantic_settings import BaseSettings, SettingsConfigDict

# Committed dev defaults — anyone with the repo knows them. core/api/main.py warns at
# startup if a deployment is still running with either of them.
DEV_ADMIN_PASSWORD_HASH = (
    "pbkdf2_sha256$260000$cb28a6f64508ae9a8200662c34d9fa9b"
    "$b3ea82a9bce5574ed640f66911f4b090718e0a541858f93f94e7c20dba413299"
)
DEV_SESSION_SECRET = "dev-insecure-session-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_ignore_empty=True)

    database_url: str = "postgresql+asyncpg://psclub:psclub@localhost:5432/psclub"
    bot_token: str | None = None
    timezone: str = "Asia/Bishkek"

    # Hall-screen login (Stage 3). These two dev defaults let a fresh checkout run
    # with zero setup (password: "admin") — replace both in .env before a real
    # deployment. See core/auth/password.py's module docstring for how to generate
    # a new ADMIN_PASSWORD_HASH.
    admin_password_hash: str = DEV_ADMIN_PASSWORD_HASH
    session_secret: str = DEV_SESSION_SECRET
    session_cookie_secure: bool = False  # set true once served over HTTPS (Stage 7)


settings = Settings()
