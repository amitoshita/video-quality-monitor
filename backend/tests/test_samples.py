from fastapi.testclient import TestClient

from tests.conftest import new_session, poor, post_samples, sample


def stored(client: TestClient, session_id: str) -> list[dict[str, object]]:
    samples: list[dict[str, object]] = client.get(f"/sessions/{session_id}").json()["samples"]
    return samples


def test_accepts_a_batch(client: TestClient) -> None:
    session_id = new_session(client)

    response = post_samples(client, session_id, [sample(1), sample(2), poor(3, "too_dark")])

    assert response.status_code == 200
    assert response.json() == {"accepted": 3, "duplicates": 0, "ignored_after_stop": 0}
    assert [s["t"] for s in stored(client, session_id)] == [1, 2, 3]


def test_resending_the_same_batch_creates_no_duplicates(client: TestClient) -> None:
    session_id = new_session(client)
    batch = [sample(1), sample(2), sample(3)]
    post_samples(client, session_id, batch)

    response = post_samples(client, session_id, batch)

    assert response.status_code == 200
    assert response.json() == {"accepted": 0, "duplicates": 3, "ignored_after_stop": 0}
    assert len(stored(client, session_id)) == 3


def test_overlapping_batches_store_each_t_once(client: TestClient) -> None:
    session_id = new_session(client)
    post_samples(client, session_id, [sample(1), sample(2), sample(3)])

    response = post_samples(client, session_id, [sample(3), sample(4), sample(5)])

    assert response.json() == {"accepted": 2, "duplicates": 1, "ignored_after_stop": 0}
    assert [s["t"] for s in stored(client, session_id)] == [1, 2, 3, 4, 5]


def test_first_write_wins_for_an_existing_t(client: TestClient) -> None:
    session_id = new_session(client)
    post_samples(client, session_id, [sample(1, fps=30.0)])

    post_samples(client, session_id, [sample(1, fps=10.0)])

    assert stored(client, session_id)[0]["fps"] == 30.0


def test_duplicate_t_within_one_batch_keeps_the_first(client: TestClient) -> None:
    session_id = new_session(client)

    response = post_samples(
        client, session_id, [sample(1, fps=30.0), sample(2), sample(1, fps=10.0)]
    )

    assert response.status_code == 200
    assert response.json() == {"accepted": 2, "duplicates": 1, "ignored_after_stop": 0}
    assert stored(client, session_id)[0]["fps"] == 30.0


def test_samples_are_isolated_per_session(client: TestClient) -> None:
    a, b = new_session(client), new_session(client)
    post_samples(client, a, [sample(1)])

    response = post_samples(client, b, [sample(1)])

    assert response.json()["accepted"] == 1


def test_new_samples_after_stop_are_ignored_and_reported(client: TestClient) -> None:
    session_id = new_session(client)
    post_samples(client, session_id, [sample(1), sample(2)])
    client.post(f"/sessions/{session_id}/stop")
    summary_before = client.get(f"/sessions/{session_id}").json()["summary"]

    response = post_samples(client, session_id, [sample(3), sample(4)])

    assert response.status_code == 200
    assert response.json() == {"accepted": 0, "duplicates": 0, "ignored_after_stop": 2}
    assert [s["t"] for s in stored(client, session_id)] == [1, 2]
    assert client.get(f"/sessions/{session_id}").json()["summary"] == summary_before


def test_resent_samples_after_stop_count_as_duplicates(client: TestClient) -> None:
    session_id = new_session(client)
    post_samples(client, session_id, [sample(1), sample(2)])
    client.post(f"/sessions/{session_id}/stop")

    response = post_samples(client, session_id, [sample(1), sample(2), sample(2), sample(3)])

    assert response.status_code == 200
    assert response.json() == {"accepted": 0, "duplicates": 3, "ignored_after_stop": 1}


def test_zero_frame_second_is_accepted(client: TestClient) -> None:
    session_id = new_session(client)
    empty_second = poor(1, "no_face", fps=0.0, brightness=None, motion=None, face=False)

    response = post_samples(client, session_id, [empty_second])

    assert response.json()["accepted"] == 1
    assert stored(client, session_id)[0] == empty_second


def test_second_without_a_motion_pair_is_accepted(client: TestClient) -> None:
    session_id = new_session(client)

    response = post_samples(
        client, session_id, [sample(1, fps=1.0, motion=None, verdict="poor", reason="low_fps")]
    )

    assert response.json()["accepted"] == 1


def test_empty_batch_is_rejected(client: TestClient) -> None:
    session_id = new_session(client)

    response = post_samples(client, session_id, [])

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_batch_size_limit(client: TestClient) -> None:
    session_id = new_session(client)

    ok = post_samples(client, session_id, [sample(t) for t in range(1, 121)])
    too_big = post_samples(client, session_id, [sample(t) for t in range(200, 321)])

    assert ok.status_code == 200
    assert too_big.status_code == 422
    assert too_big.json()["error"]["code"] == "batch_too_large"
