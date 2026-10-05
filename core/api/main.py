import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

from core.api.admin import register_admin
from core.api.errors import register_exception_handlers
from core.api.routes.analytics import router as analytics_router
from core.api.routes.auth import router as auth_router
from core.api.routes.bar import orders_router, products_router
from core.api.routes.business_days import router as business_days_router
from core.api.routes.games import router as games_router
from core.api.routes.hall import router as hall_router
from core.api.routes.hall_ws import router as hall_ws_router
from core.api.routes.health import router as health_router
from core.api.routes.sessions import router as sessions_router
from core.api.routes.settings import router as settings_router
from core.api.routes.tariffs import router as tariffs_router
from core.api.routes.tickets import router as tickets_router
from core.api.ws.listener import hall_listener
from core.config import DEV_ADMIN_PASSWORD_HASH, DEV_SESSION_SECRET, Settings, settings
from core.db.session import engine

SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days — one login per till PC per month

logger = logging.getLogger(__name__)


def warn_about_dev_secrets(config: Settings) -> None:
    """Warn, don't refuse to start: an empty value in .env silently falls back to the
    committed dev default (env_ignore_empty), and a config typo must not take the
    club's only till offline."""
    if config.session_secret == DEV_SESSION_SECRET:
        logger.warning(
            "SESSION_SECRET is still the development default - anyone with the repo can "
            "forge a login cookie. Set a random value in .env before a real deployment "
            "(see .env.example)."
        )
    if config.admin_password_hash == DEV_ADMIN_PASSWORD_HASH:
        logger.warning(
            "ADMIN_PASSWORD_HASH is still the development default - the password is "
            "'admin'. Set a real hash in .env before a real deployment (see .env.example)."
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    await hall_listener.start()
    try:
        yield
    finally:
        await hall_listener.stop()
        # Pooled asyncpg connections are bound to this event loop; close them with it.
        await engine.dispose()


def create_app() -> FastAPI:
    warn_about_dev_secrets(settings)
    app = FastAPI(title="PS Club API", lifespan=lifespan)
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        max_age=SESSION_MAX_AGE_SECONDS,
        same_site="lax",
        https_only=settings.session_cookie_secure,
    )
    register_exception_handlers(app)
    register_admin(app)
    app.include_router(health_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.include_router(settings_router, prefix="/api")
    app.include_router(tariffs_router, prefix="/api")
    app.include_router(games_router, prefix="/api")
    app.include_router(business_days_router, prefix="/api")
    app.include_router(analytics_router, prefix="/api")
    app.include_router(sessions_router, prefix="/api")
    app.include_router(tickets_router, prefix="/api")
    app.include_router(products_router, prefix="/api")
    app.include_router(orders_router, prefix="/api")
    app.include_router(hall_router, prefix="/api")
    app.include_router(hall_ws_router, prefix="/api")
    return app


app = create_app()
