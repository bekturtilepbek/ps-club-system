"""In-memory login throttle: a few wrong passwords per client IP, then a cool-down.

State lives in the API process. That is fine here: the prod stack runs a single uvicorn
worker, and a restart merely forgives everyone. The key is the client IP uvicorn derives
from X-Forwarded-For (--proxy-headers), so Caddy must overwrite that header, never
forward a client-supplied one (see docker/Caddyfile).
"""

import time
from collections import deque
from collections.abc import Callable

MAX_FAILURES = 5
WINDOW_SECONDS = 15 * 60
MAX_TRACKED_CLIENTS = 1000  # bounds memory against an attacker rotating addresses


class LoginThrottle:
    def __init__(
        self,
        *,
        max_failures: int = MAX_FAILURES,
        window_seconds: float = WINDOW_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._max_failures = max_failures
        self._window = window_seconds
        self._clock = clock
        self._failures: dict[str, deque[float]] = {}

    def _recent(self, key: str) -> deque[float]:
        failures = self._failures.get(key)
        if failures is None:
            return deque()
        cutoff = self._clock() - self._window
        while failures and failures[0] <= cutoff:
            failures.popleft()
        if not failures:
            del self._failures[key]
        return failures

    def retry_after(self, key: str) -> int:
        """Seconds until `key` may try again; 0 when it is not locked out."""
        failures = self._recent(key)
        if len(failures) < self._max_failures:
            return 0
        return max(1, int(failures[0] + self._window - self._clock()) + 1)

    def record_failure(self, key: str) -> None:
        if key not in self._failures and len(self._failures) >= MAX_TRACKED_CLIENTS:
            self._evict_stale()
            if len(self._failures) >= MAX_TRACKED_CLIENTS:
                # Still full of live entries: drop the oldest-tracked client.
                self._failures.pop(next(iter(self._failures)))
        self._failures.setdefault(key, deque()).append(self._clock())

    def reset(self, key: str) -> None:
        self._failures.pop(key, None)

    def _evict_stale(self) -> None:
        for key in list(self._failures):
            self._recent(key)


login_throttle = LoginThrottle()
