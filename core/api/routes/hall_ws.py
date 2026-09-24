from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.api.clock import now as _now
from core.api.schemas.hall import hall_snapshot_to_response
from core.api.ws.manager import manager
from core.db.session import async_session_factory
from core.services import hall as hall_service

router = APIRouter(tags=["hall"])


@router.websocket("/ws/hall")
async def hall_ws(websocket: WebSocket) -> None:
    if not websocket.session.get("authenticated"):
        await websocket.close(code=1008)
        return

    await websocket.accept()
    await manager.connect(websocket)
    try:
        async with async_session_factory() as db:
            snapshot = await hall_service.build_hall_snapshot(db, _now())
        await websocket.send_json(hall_snapshot_to_response(snapshot).model_dump(mode="json"))

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)
