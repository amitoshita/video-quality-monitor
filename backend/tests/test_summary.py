from fastapi.testclient import TestClient

from tests.conftest import new_session, poor, post_samples, sample


def summary_of(client: TestClient, session_id: str) -> dict[str, object]:
    detail = client.get(f"/sessions/{session_id}").json()["summary"]
    listed = next(i for i in client.get("/sessions").json()["items"] if i["id"] == session_id)
    assert listed["summary"] == detail, "list and detail must agree"
    result: dict[str, object] = detail
    return result


def test_empty_session_has_zero_duration_and_null_stats(client: TestClient) -> None:
    session_id = new_session(client)

    assert summary_of(client, session_id) == {
        "duration_s": 0,
        "sample_count": 0,
        "avg_fps": None,
        "face_pct": None,
        "good_pct": None,
    }


def test_summary_math(client: TestClient) -> None:
    session_id = new_session(client)
    post_samples(
        client,
        session_id,
        [
            sample(1, fps=30.0),
            poor(2, "no_face", fps=20.0, face=False),
            poor(3, "too_dark", fps=25.0, brightness=10.0),
            sample(4, fps=29.0),
        ],
    )

    assert summary_of(client, session_id) == {
        "duration_s": 4,
        "sample_count": 4,
        "avg_fps": 26.0,
        "face_pct": 75.0,
        "good_pct": 50.0,
    }


def test_duration_is_t_of_the_last_sample_even_with_gaps(client: TestClient) -> None:
    # A lost second (e.g. tab closed mid-batch) must not shrink the duration.
    session_id = new_session(client)
    post_samples(client, session_id, [sample(1), sample(2), sample(7)])

    summary = summary_of(client, session_id)

    assert summary["duration_s"] == 7
    assert summary["sample_count"] == 3


def test_summary_works_without_stop(client: TestClient) -> None:
    session_id = new_session(client)
    post_samples(client, session_id, [sample(t) for t in range(1, 11)])

    assert client.get(f"/sessions/{session_id}").json()["ended_at"] is None
    assert summary_of(client, session_id)["duration_s"] == 10


def test_percentages_round_half_up_to_one_decimal(client: TestClient) -> None:
    session_id = new_session(client)
    # 1 good of 3 -> 33.333..., 2 faces of 3 -> 66.666...
    post_samples(
        client,
        session_id,
        [sample(1), poor(2, "no_face", face=False), poor(3, "hold_still", motion=40.0)],
    )
    summary = summary_of(client, session_id)
    assert summary["good_pct"] == 33.3
    assert summary["face_pct"] == 66.7

    other = new_session(client)
    post_samples(client, other, [sample(1, fps=10.25), sample(2, fps=10.0)])  # avg 10.125
    assert summary_of(client, other)["avg_fps"] == 10.1

    half = new_session(client)
    post_samples(client, half, [sample(1, fps=10.25), sample(2, fps=10.25)])  # exactly 10.25
    assert summary_of(client, half)["avg_fps"] == 10.3  # half-up, not banker's 10.2


def test_zero_frame_seconds_count_towards_avg_fps(client: TestClient) -> None:
    session_id = new_session(client)
    post_samples(
        client,
        session_id,
        [
            sample(1, fps=30.0),
            poor(2, "no_face", fps=0.0, brightness=None, motion=None, face=False),
        ],
    )

    summary = summary_of(client, session_id)

    assert summary["avg_fps"] == 15.0
    assert summary["face_pct"] == 50.0
