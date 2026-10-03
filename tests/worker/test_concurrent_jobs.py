import asyncio
import threading

import pytest

from core.worker import main as worker

ROUNDS = 8
ROUND_TIMEOUT_SECONDS = 20


async def _run_both_jobs_at_once() -> list[str]:
    """APScheduler runs jobs on a thread pool and the heartbeat (every 30 s) and the
    unclosed-day reminder (every 5 min) fire in the same millisecond every 5 minutes,
    each doing its own asyncio.run(). Returns the names of jobs that never finished.
    Daemon threads: a regression must fail this test, not hang the whole test run."""
    barrier = threading.Barrier(2)
    done: dict[str, threading.Event] = {}

    def run(job):
        finished = done.setdefault(job.__name__, threading.Event())
        barrier.wait()
        job()
        finished.set()

    threads = []
    for job in (worker.heartbeat, worker.check_unclosed_day_reminder):
        done[job.__name__] = threading.Event()
        thread = threading.Thread(target=run, args=(job,), daemon=True)
        thread.start()
        threads.append(thread)

    waited = 0.0
    while waited < ROUND_TIMEOUT_SECONDS and not all(event.is_set() for event in done.values()):
        await asyncio.sleep(0.1)
        waited += 0.1
    return [name for name, event in done.items() if not event.is_set()]


@pytest.mark.asyncio
async def test_heartbeat_and_reminder_firing_together_never_block_each_other(db_session):
    for round_number in range(ROUNDS):
        hung = await _run_both_jobs_at_once()
        assert hung == [], f"round {round_number}: {hung} never finished (the worker would freeze)"


@pytest.mark.asyncio
async def test_a_job_stuck_on_the_database_is_cut_off_instead_of_holding_its_slot_forever(
    monkeypatch,
):
    """APScheduler runs one instance of a job at a time: a job that never returns means the
    heartbeat (or the reminder) silently stops for good."""
    import time

    async def never_returns() -> None:
        await asyncio.sleep(30)

    monkeypatch.setattr(worker, "_record_heartbeat_async", never_returns)
    monkeypatch.setattr(worker, "JOB_TIMEOUT_SECONDS", 0.3)

    started = time.perf_counter()
    await asyncio.to_thread(worker.heartbeat)

    assert time.perf_counter() - started < 5
