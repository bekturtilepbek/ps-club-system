from fastapi import FastAPI

from core.api.routes.health import router as health_router


def create_app() -> FastAPI:
    app = FastAPI(title="PS Club API")
    app.include_router(health_router, prefix="/api")
    return app


app = create_app()
