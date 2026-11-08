import uuid
from datetime import datetime

from fastapi.testclient import TestClient

from tests.conftest import new_session, post_samples, sample


def test_healthz(client: TestClient) -> None:
    assert client.get("/healthz").json() == {"status": "ok"}


def test_config_exposes_thresholds_from_settings(client: TestClient) -> None:
    assert client.get("/config").json() == {
        "thresholds": {
            "min_fps": 15.0,
            "min_brightness": 60.0,
            "max_brightness": 200.0,
            "max_motion": 20.0,
        },
        "max_batch_size": 120,
    }


def test_create_session(client: TestClient) -> None:
    response = client.post("/sessions")

    assert response.status_code == 201
    body = response.json()
    assert uuid.UUID(body["id"]).version == 4
    assert datetime.fromisoformat(body["started_at"]).utcoffset() is not None
    assert body["ended_at"] is None


def test_get_session_returns_samples_ordered_by_t(client: TestClient) -> None:
    session_id = new_session(client)
    post_samples(client, session_id, [sample(3), sample(1)])
    post_samples(client, session_id, [sample(2)])

    body = client.get(f"/sessions/{session_id}").json()

    assert body["id"] == session_id
    assert [s["t"] for s in body["samples"]] == [1, 2, 3]
    assert body["samples"][0] == sample(1)
    assert body["summary"]["duration_s"] == 3


def test_unknown_session_is_404(client: TestClient) -> None:
    unknown = uuid.uuid4()
    for method, path in [
        ("GET", f"/sessions/{unknown}"),
        ("POST", f"/sessions/{unknown}/stop"),
    ]:
        response = client.request(method, path)
        assert response.status_code == 404
        assert response.json() == {
            "error": {"code": "session_not_found", "message": "Session not found"}
        }
    assert post_samples(client, str(unknown), [sample(1)]).status_code == 404


def test_malformed_session_id_is_the_same_404(client: TestClient) -> None:
    for path in ["/sessions/not-a-uuid", "/sessions/123/stop"]:
        response = client.get(path) if "stop" not in path else client.post(path)
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "session_not_found"


def test_stop_sets_ended_at(client: TestClient) -> None:
    session_id = new_session(client)

    response = client.post(f"/sessions/{session_id}/stop")

    assert response.status_code == 200
    ended_at = datetime.fromisoformat(response.json()["ended_at"])
    started_at = datetime.fromisoformat(response.json()["started_at"])
    assert ended_at >= started_at


def test_stop_twice_returns_the_original_ended_at(client: TestClient) -> None:
    session_id = new_session(client)
    first = client.post(f"/sessions/{session_id}/stop")

    second = client.post(f"/sessions/{session_id}/stop")

    assert second.status_code == 200
    assert second.json() == first.json()
    assert client.get(f"/sessions/{session_id}").json()["ended_at"] == first.json()["ended_at"]


def test_list_is_newest_first_with_summaries(client: TestClient) -> None:
    first = new_session(client)
    second = new_session(client)
    third = new_session(client)
    post_samples(client, second, [sample(1), sample(2)])

    body = client.get("/sessions").json()

    assert [item["id"] for item in body["items"]] == [third, second, first]
    assert body["total"] == 3
    assert body["items"][1]["summary"]["duration_s"] == 2
    assert body["items"][0]["summary"]["sample_count"] == 0


def test_list_pagination(client: TestClient) -> None:
    ids = [new_session(client) for _ in range(5)]

    body = client.get("/sessions", params={"limit": 2, "offset": 1}).json()

    assert [item["id"] for item in body["items"]] == [ids[3], ids[2]]
    assert (body["total"], body["limit"], body["offset"]) == (5, 2, 1)


def test_list_rejects_bad_pagination(client: TestClient) -> None:
    for params in [{"limit": 0}, {"limit": 201}, {"offset": -1}, {"limit": "x"}]:
        response = client.get("/sessions", params=params)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"
