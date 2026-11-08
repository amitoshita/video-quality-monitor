import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings
from app.db import make_engine, make_session_factory
from app.errors import CatchAllMiddleware, register_exception_handlers
from app.routes import router


def create_app(settings: Settings | None = None) -> FastAPI:
    """App factory (run with `uvicorn --factory app.main:create_app`).

    Missing or invalid configuration raises here, so the process fails at startup instead of
    on the first request.
    """
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level.upper())

    app = FastAPI(title="Video Quality Monitor API", version="1.0.0")
    app.state.settings = settings
    app.state.session_factory = make_session_factory(make_engine(settings.database_url))

    register_exception_handlers(app)
    app.include_router(router)

    # Order matters: the middleware added last is the outermost one. CORS must wrap the
    # catch-all so error responses still carry CORS headers.
    app.add_middleware(CatchAllMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
        allow_credentials=False,
        max_age=600,
    )
    return app
