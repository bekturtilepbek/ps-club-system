"""merge qr payments into transfer

Revision ID: b7d2f0a8c314
Revises: a1c4e7d29b53
Create Date: 2026-10-01 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b7d2f0a8c314'
down_revision: Union[str, None] = 'a1c4e7d29b53'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Owner decision: QR and bank transfer are the same thing for the till, keep one.
    # The column is a plain VARCHAR (no DB enum), so only the data needs converting.
    op.execute("UPDATE payments SET method = 'transfer' WHERE method = 'qr'")


def downgrade() -> None:
    # Irreversible by nature: which transfers were QR is no longer known. The old code
    # still reads every remaining row ('transfer' is valid in both versions).
    pass
