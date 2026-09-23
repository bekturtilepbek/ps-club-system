from fastapi import FastAPI

from core.api.errors import register_exception_handlers
from core.api.routes.business_days import router as business_days_router
from core.api.routes.health import router as health_router
from core.api.routes.sessions import router as sessions_router


def create_app() -> FastAPI:
    app = FastAPI(title="PS Club API")
    register_exception_handlers(app)
    app.include_router(health_router, prefix="/api")
    app.include_router(business_days_router, prefix="/api")
    app.include_router(sessions_router, prefix="/api")
    return app


app = create_app()
