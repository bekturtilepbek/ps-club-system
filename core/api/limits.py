"""Upper and lower bounds for what the API accepts.

Everything stored as a 32-bit integer in Postgres must be bounded here: an id or an amount that
does not fit makes asyncpg raise and the operator gets a bare "500" instead of a clear message.
"""

from typing import Annotated

from fastapi import Path

INT32_MAX = 2_147_483_647
MAX_MONEY = 10_000_000  # som; a whole day's takings are tens of thousands, this only stops typos
MAX_QTY = 1000  # of one product in one tap
MAX_REASON_LENGTH = 200  # sessions.reason is VARCHAR(200)
MAX_COMMENT_LENGTH = 1000

# A database id in a URL or a request body.
EntityId = Annotated[int, Path(ge=1, le=INT32_MAX)]
