"""add session game

Revision ID: c3e91a5d7f20
Revises: b7d2f0a8c314
Create Date: 2026-10-01 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3e91a5d7f20'
down_revision: Union[str, None] = 'b7d2f0a8c314'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sessions', sa.Column('game', sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column('sessions', 'game')
