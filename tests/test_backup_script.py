"""docker/backup.sh with a fake pg_dump on PATH: a failed dump must never look like a backup."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "docker" / "backup.sh"

pytestmark = pytest.mark.skipif(
    shutil.which("sh") is None or shutil.which("gzip") is None, reason="needs sh and gzip"
)


def _run_backup(tmp_path: Path, fake_pg_dump: str) -> tuple[subprocess.CompletedProcess | None, Path]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    dump_dir = tmp_path / "backups"
    pg_dump = bin_dir / "pg_dump"
    pg_dump.write_text("#!/bin/sh\n" + fake_pg_dump + "\n", newline="\n")
    pg_dump.chmod(0o755)
    env = {
        **os.environ,
        "PATH": f"{bin_dir.as_posix()}{os.pathsep}{os.environ['PATH']}",
        "BACKUP_DIR": dump_dir.as_posix(),
        "BACKUP_INTERVAL_SECONDS": "1",
        "BACKUP_ONCE": "1",
    }
    try:
        result = subprocess.run(
            ["sh", SCRIPT.as_posix()], env=env, capture_output=True, text=True, timeout=15
        )
    except subprocess.TimeoutExpired:
        result = None  # the script kept looping; the files below still tell what it did
    return result, dump_dir


def _dumps(dump_dir: Path) -> list[Path]:
    return sorted(dump_dir.glob("psclub-*.sql.gz")) if dump_dir.exists() else []


def test_a_dump_that_fails_without_output_is_not_stored_as_a_backup(tmp_path):
    result, dump_dir = _run_backup(tmp_path, "echo 'pg_dump: connection refused' >&2\nexit 1")

    assert _dumps(dump_dir) == []
    assert result is not None and result.returncode != 0
    assert "backup FAILED" in result.stderr


def test_a_dump_that_dies_halfway_is_not_stored_as_a_backup(tmp_path):
    result, dump_dir = _run_backup(tmp_path, "echo 'CREATE TABLE half (id int);'\nexit 1")

    assert _dumps(dump_dir) == []
    assert result is not None and "backup FAILED" in result.stderr


def test_a_successful_dump_is_stored_and_the_script_exits_cleanly_in_one_shot_mode(tmp_path):
    result, dump_dir = _run_backup(tmp_path, "echo 'CREATE TABLE ok (id int);'")

    dumps = _dumps(dump_dir)
    assert len(dumps) == 1 and dumps[0].stat().st_size > 20
    assert result is not None and result.returncode == 0
    assert "backup ok" in result.stdout
