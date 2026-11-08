from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import new_session, poor, sample


def without(field: str) -> dict[str, Any]:
    value = sample(1)
    del value[field]
    return value


INVALID_SAMPLES: list[tuple[str, dict[str, Any]]] = [
    ("missing t", without("t")),
    ("missing fps", without("fps")),
    ("missing brightness", without("brightness")),
    ("missing face", without("face")),
    ("missing reason", without("reason")),
    ("fps above 120", sample(1, fps=120.1)),
    ("negative fps", sample(1, fps=-1)),
    ("brightness above 255", sample(1, brightness=255.5)),
    ("negative brightness", sample(1, brightness=-0.1)),
    ("motion above 255", sample(1, motion=256)),
    ("negative t", sample(-1)),
    ("t too large", sample(86401)),
    ("fractional t", sample(1.5)),  # type: ignore[arg-type]
    ("t as string", sample("1")),  # type: ignore[arg-type]
    ("t as bool", sample(True)),
    ("fps as string", sample(1, fps="30")),
    ("face as string", sample(1, face="true")),
    ("face as int", sample(1, face=1)),
    ("unknown verdict", sample(1, verdict="ok")),
    ("unknown reason", poor(1, "blurry")),
    ("extra field", sample(1, extra=1)),
    ("reason with good", sample(1, reason="too_dark")),
    ("poor without reason", sample(1, verdict="poor")),
    ("no brightness with frames", sample(1, brightness=None)),
    ("brightness without frames", poor(1, "no_face", fps=0, motion=None, face=False)),
    ("motion without frames", poor(1, "no_face", fps=0, brightness=None, face=False)),
]


@pytest.mark.parametrize(("case", "payload"), INVALID_SAMPLES, ids=[c for c, _ in INVALID_SAMPLES])
def test_invalid_sample_is_422_with_envelope(
    client: TestClient, case: str, payload: dict[str, Any]
) -> None:
    session_id = new_session(client)

    response = client.post(f"/sessions/{session_id}/samples", json={"samples": [payload]})

    assert response.status_code == 422, case
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["message"] == "Request is invalid"
    assert error["details"] and set(error["details"][0]) == {"loc", "msg", "type"}


@pytest.mark.parametrize("token", ["NaN", "Infinity", "-Infinity"])
def test_non_finite_numbers_are_rejected(client: TestClient, token: str) -> None:
    # JSON.stringify never emits these, but other clients (and Python's json) can.
    session_id = new_session(client)
    body = (
        '{"samples": [{"t": 1, "fps": 30, "brightness": BRIGHTNESS, "motion": 1,'
        ' "face": true, "verdict": "good", "reason": null}]}'
    ).replace("BRIGHTNESS", token)

    response = client.post(
        f"/sessions/{session_id}/samples",
        content=body,
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 422
    # The range checks would also reject these; this asserts the explicit finiteness guard.
    assert response.json()["error"]["details"][0]["type"] == "finite_number"


@pytest.mark.parametrize(
    "body",
    ["not json", "[]", '{"samples": {}}', '{"samples": [], "extra": 1}', "{}"],
)
def test_malformed_body_is_422(client: TestClient, body: str) -> None:
    session_id = new_session(client)

    response = client.post(
        f"/sessions/{session_id}/samples",
        content=body,
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_a_single_bad_sample_rejects_the_batch_atomically(client: TestClient) -> None:
    session_id = new_session(client)

    response = client.post(
        f"/sessions/{session_id}/samples",
        json={"samples": [sample(1), sample(2, fps=500)]},
    )

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["loc"] == ["body", "samples", 1, "fps"]
    assert client.get(f"/sessions/{session_id}").json()["samples"] == []


def test_integer_numbers_are_accepted_for_float_fields(client: TestClient) -> None:
    session_id = new_session(client)

    response = client.post(
        f"/sessions/{session_id}/samples",
        json={"samples": [sample(1, fps=30, brightness=0, motion=255)]},
    )

    assert response.status_code == 200
