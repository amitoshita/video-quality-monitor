"""Vocabulary shared by the API schemas and the database constraints."""

from typing import Literal, get_args

Verdict = Literal["good", "poor"]

# Listed in the spec's priority order: when several metrics fail, the client reports the first.
Reason = Literal["no_face", "too_dark", "too_bright", "hold_still", "low_fps"]

VERDICTS: tuple[str, ...] = get_args(Verdict)
REASONS: tuple[str, ...] = get_args(Reason)

MAX_T_SECONDS = 24 * 60 * 60
