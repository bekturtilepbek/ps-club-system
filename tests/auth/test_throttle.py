from core.auth.throttle import LoginThrottle


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def make(clock: FakeClock, **kwargs) -> LoginThrottle:
    return LoginThrottle(max_failures=3, window_seconds=60, clock=clock, **kwargs)


def test_allows_attempts_until_the_limit_is_reached() -> None:
    throttle = make(FakeClock())
    for _ in range(2):
        throttle.record_failure("1.1.1.1")
    assert throttle.retry_after("1.1.1.1") == 0

    throttle.record_failure("1.1.1.1")
    assert throttle.retry_after("1.1.1.1") > 0


def test_lockout_is_per_client() -> None:
    throttle = make(FakeClock())
    for _ in range(3):
        throttle.record_failure("1.1.1.1")

    assert throttle.retry_after("1.1.1.1") > 0
    assert throttle.retry_after("2.2.2.2") == 0


def test_lockout_expires_after_the_window() -> None:
    clock = FakeClock()
    throttle = make(clock)
    for _ in range(3):
        throttle.record_failure("1.1.1.1")

    clock.now += 59
    assert throttle.retry_after("1.1.1.1") > 0
    clock.now += 2
    assert throttle.retry_after("1.1.1.1") == 0


def test_retry_after_counts_down_from_the_oldest_failure() -> None:
    clock = FakeClock()
    throttle = make(clock)
    throttle.record_failure("1.1.1.1")
    clock.now += 20
    throttle.record_failure("1.1.1.1")
    throttle.record_failure("1.1.1.1")

    assert 39 <= throttle.retry_after("1.1.1.1") <= 42


def test_success_clears_the_failures() -> None:
    throttle = make(FakeClock())
    for _ in range(2):
        throttle.record_failure("1.1.1.1")
    throttle.reset("1.1.1.1")
    throttle.record_failure("1.1.1.1")

    assert throttle.retry_after("1.1.1.1") == 0


def test_memory_is_bounded_when_many_addresses_fail() -> None:
    throttle = make(FakeClock())
    for i in range(1500):
        throttle.record_failure(f"10.0.{i // 250}.{i % 250}")

    assert len(throttle._failures) <= 1000
