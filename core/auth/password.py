"""Stdlib-only password hashing — no new dependency for a single shared password
(CLAUDE.md: don't add infrastructure without asking; bcrypt/passlib would be one
more supply-chain surface for something hashlib already does adequately here)."""

import hashlib
import hmac
import os
import sys

_ALGORITHM = "pbkdf2_sha256"
_ITERATIONS = 260_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"{_ALGORITHM}${_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations_str, salt_hex, digest_hex = encoded.split("$")
        if algorithm != _ALGORITHM:
            return False
        iterations = int(iterations_str)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except ValueError:
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return hmac.compare_digest(actual, expected)


if __name__ == "__main__":
    # `uv run python -m core.auth.password 'new-password'` — prints a hash to paste
    # into ADMIN_PASSWORD_HASH in .env.
    print(hash_password(sys.argv[1]))
