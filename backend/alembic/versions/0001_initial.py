"""Create sessions and samples.

Revision ID: 0001
Revises:
Create Date: 2026-11-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_sessions"),
    )
    op.create_index("ix_sessions_started_at", "sessions", [sa.text("started_at DESC")])

    op.create_table(
        "samples",
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("t", sa.Integer(), nullable=False),
        sa.Column("fps", sa.Float(), nullable=False),
        sa.Column("brightness", sa.Float(), nullable=True),
        sa.Column("motion", sa.Float(), nullable=True),
        sa.Column("face", sa.Boolean(), nullable=False),
        sa.Column("verdict", sa.String(length=8), nullable=False),
        sa.Column("reason", sa.String(length=16), nullable=True),
        sa.CheckConstraint("verdict IN ('good', 'poor')", name="ck_samples_verdict"),
        sa.CheckConstraint(
            "reason IS NULL OR reason IN "
            "('no_face', 'too_dark', 'too_bright', 'hold_still', 'low_fps')",
            name="ck_samples_reason",
        ),
        sa.CheckConstraint(
            "(verdict = 'good' AND reason IS NULL) OR (verdict = 'poor' AND reason IS NOT NULL)",
            name="ck_samples_reason_matches_verdict",
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["sessions.id"],
            name="fk_samples_session_id_sessions",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("session_id", "t", name="pk_samples"),
    )


def downgrade() -> None:
    op.drop_table("samples")
    op.drop_index("ix_sessions_started_at", table_name="sessions")
    op.drop_table("sessions")
