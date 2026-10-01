from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base


class Game(Base):
    """The owner's fixed list of games guests can say they are about to play (analytics)."""

    __tablename__ = "games"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    # Hidden games vanish from the start dialog but stay on the sessions that used them.
    is_active: Mapped[bool] = mapped_column(default=True)

    def __str__(self) -> str:
        return self.name
