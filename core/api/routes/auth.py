from fastapi import APIRouter, HTTPException, Request

from core.api.schemas.auth import AuthStatusResponse, LoginRequest
from core.auth.password import verify_password
from core.auth.throttle import login_throttle
from core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=AuthStatusResponse)
async def login(body: LoginRequest, request: Request) -> AuthStatusResponse:
    client = request.client.host if request.client else "unknown"
    retry_after = login_throttle.retry_after(client)
    if retry_after:
        raise HTTPException(
            status_code=429,
            detail="too many failed attempts",
            headers={"Retry-After": str(retry_after)},
        )
    if not verify_password(body.password, settings.admin_password_hash):
        login_throttle.record_failure(client)
        raise HTTPException(status_code=401, detail="invalid password")
    login_throttle.reset(client)
    request.session["authenticated"] = True
    return AuthStatusResponse(authenticated=True)


@router.post("/logout", response_model=AuthStatusResponse)
async def logout(request: Request) -> AuthStatusResponse:
    request.session.clear()
    return AuthStatusResponse(authenticated=False)


@router.get("/me", response_model=AuthStatusResponse)
async def me(request: Request) -> AuthStatusResponse:
    return AuthStatusResponse(authenticated=bool(request.session.get("authenticated")))
