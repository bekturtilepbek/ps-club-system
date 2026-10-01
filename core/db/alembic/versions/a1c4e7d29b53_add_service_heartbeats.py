"""add service heartbeats

Revision ID: a1c4e7d29b53
Revises: 3145122b209f
Create Date: 2026-10-01 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1c4e7d29b53'
down_revision: Union[str, None] = '3145122b209f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('service_heartbeats',
    sa.Column('name', sa.String(length=50), nullable=False),
    sa.Column('beat_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('name')
    )


def downgrade() -> None:
    op.drop_table('service_heartbeats')
