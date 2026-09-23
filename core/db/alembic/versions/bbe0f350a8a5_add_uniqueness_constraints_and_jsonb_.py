"""add uniqueness constraints and jsonb audit details

Revision ID: bbe0f350a8a5
Revises: fc0da24014d6
Create Date: 2026-09-23 12:26:42.940369

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bbe0f350a8a5'
down_revision: Union[str, None] = 'fc0da24014d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "CREATE UNIQUE INDEX ux_sessions_one_active_per_console "
        "ON sessions (console_id) WHERE status = 'active'"
    )
    op.execute(
        "CREATE UNIQUE INDEX ux_business_days_one_open "
        "ON business_days ((1)) WHERE closed_at IS NULL"
    )
    op.execute("ALTER TABLE audit_log ALTER COLUMN details TYPE JSONB USING details::jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE audit_log ALTER COLUMN details TYPE JSON USING details::json")
    op.execute("DROP INDEX ux_business_days_one_open")
    op.execute("DROP INDEX ux_sessions_one_active_per_console")
