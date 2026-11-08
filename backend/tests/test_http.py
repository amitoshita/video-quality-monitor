"""CORS, the error envelope for non-validation errors, and startup configuration."""

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.main import create_app
from tests.conftest import FRONTEND_ORIGIN, make_settings


def preflight(client: TestClient, origin: str) -> httpx.Response:
    response: httpx.Response = client.options(
        "/sessions",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    return response


def test_cors_allows_the_configured_origin(client: TestClient) -> None:
    response = preflight(client, FRONTEND_ORIGIN)
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == FRONTEND_ORIGIN
    assert "access-control-allow-credentials" not in response.headers

    simple = client.get("/sessions", headers={"Origin": FRONTEND_ORIGIN})
    assert simple.headers["access-control-allow-origin"] == FRONTEND_ORIGIN


def test_cors_rejects_other_origins(client: TestClient) -> None:
    response = preflight(client, "https://evil.example")
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers

    simple = client.get("/sessions", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in simple.headers


def test_unknown_route_uses_the_envelope(client: TestClient) -> None:
    response = client.get("/nope")
    assert response.status_code == 404
    assert response.json() == {"error": {"code": "not_found", "message": "Not Found"}}


def test_wrong_method_uses_the_envelope(client: TestClient) -> None:
    response = client.delete("/sessions")
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"


@pytest.fixture
def broken_app(settings: Settings) -> FastAPI:
    app = create_app(settings)

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("secret internals")

    return app


def test_unhandled_error_is_a_500_envelope_without_internals(broken_app: FastAPI) -> None:
    client = TestClient(broken_app, raise_server_exceptions=False)

    response = client.get("/boom", headers={"Origin": FRONTEND_ORIGIN})

    assert response.status_code == 500
    assert response.json() == {
        "error": {"code": "internal_error", "message": "Internal server error"}
    }
    assert "secret" not in response.text
    # Without this header the browser would hide the 500 behind a CORS error.
    assert response.headers["access-control-allow-origin"] == FRONTEND_ORIGIN


def test_settings_split_and_normalise_origins() -> None:
    settings = make_settings("sqlite://", cors_origins=" https://a.example/ ,https://b.example")
    assert settings.cors_origins == ["https://a.example", "https://b.example"]


@pytest.mark.parametrize("origins", ["*", "https://a.example,*", ""])
def test_settings_reject_wildcard_or_empty_origins(origins: str) -> None:
    with pytest.raises(ValidationError):
        make_settings("sqlite://", cors_origins=origins)


def test_settings_use_psycopg3_for_postgres_urls() -> None:
    for url in ["postgres://u:p@h/db?sslmode=require", "postgresql://u:p@h/db?sslmode=require"]:
        settings = make_settings(url)
        assert settings.database_url == "postgresql+psycopg://u:p@h/db?sslmode=require"


def test_settings_require_ordered_brightness_limits() -> None:
    with pytest.raises(ValidationError, match="MIN_BRIGHTNESS"):
        make_settings("sqlite://", min_brightness=200, max_brightness=60)


def test_settings_fail_fast_when_required_values_are_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in ["DATABASE_URL", "CORS_ORIGINS", "MIN_FPS"]:
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(ValidationError) as excinfo:
        Settings(_env_file=None)
    missing = {e["loc"][0] for e in excinfo.value.errors() if e["type"] == "missing"}
    assert {"database_url", "cors_origins", "min_fps", "max_motion"} <= missing
