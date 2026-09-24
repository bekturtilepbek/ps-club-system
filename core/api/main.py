from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

from core.api.admin import register_admin
from core.api.errors import register_exception_handlers
from core.api.routes.auth import router as auth_router
from core.api.routes.business_days import router as business_days_router
from core.api.routes.hall import router as hall_router
from core.api.routes.health import router as health_router
from core.api.routes.sessions import router as sessions_router
from core.api.routes.settings import router as settings_router
from core.api.routes.tariffs import router as tariffs_router
from core.config import settings

SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days — one login per till PC per month


def create_app() -> FastAPI:
    app = FastAPI(title="PS Club API")
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
    app.include_router(business_days_router, prefix="/api")
    app.include_router(sessions_router, prefix="/api")
    app.include_router(hall_router, prefix="/api")
    return app


app = create_app()
