import logging

from core.api.main import warn_about_dev_secrets
from core.config import DEV_ADMIN_PASSWORD_HASH, DEV_SESSION_SECRET, Settings


def test_warns_when_dev_defaults_are_still_in_place(caplog):
    config = Settings(
        session_secret=DEV_SESSION_SECRET, admin_password_hash=DEV_ADMIN_PASSWORD_HASH
    )
    with caplog.at_level(logging.WARNING, logger="core.api.main"):
        warn_about_dev_secrets(config)

    messages = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert any("SESSION_SECRET" in m for m in messages)
    assert any("ADMIN_PASSWORD_HASH" in m for m in messages)


def test_stays_quiet_when_real_values_are_set(caplog):
    config = Settings(
        session_secret="a-real-random-secret", admin_password_hash="pbkdf2_sha256$1$aa$bb"
    )
    with caplog.at_level(logging.WARNING, logger="core.api.main"):
        warn_about_dev_secrets(config)

    assert not [r for r in caplog.records if r.levelno >= logging.WARNING]
