"""replace session game text with a games list

Revision ID: d4a6b8c0e1f3
Revises: c3e91a5d7f20
Create Date: 2026-10-02 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4a6b8c0e1f3'
down_revision: Union[str, None] = 'c3e91a5d7f20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('games',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.true(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name')
    )
    op.add_column('sessions', sa.Column('game_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_sessions_game_id_games', 'sessions', 'games', ['game_id'], ['id'])
    # Free-text names typed so far become the first entries of the list.
    op.execute("INSERT INTO games (name) SELECT DISTINCT game FROM sessions WHERE game IS NOT NULL")
    op.execute("UPDATE sessions SET game_id = games.id FROM games WHERE games.name = sessions.game")
    op.drop_column('sessions', 'game')


def downgrade() -> None:
    op.add_column('sessions', sa.Column('game', sa.String(length=100), nullable=True))
    op.execute("UPDATE sessions SET game = games.name FROM games WHERE games.id = sessions.game_id")
    op.drop_constraint('fk_sessions_game_id_games', 'sessions', type_='foreignkey')
    op.drop_column('sessions', 'game_id')
    op.drop_table('games')
