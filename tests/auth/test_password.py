from core.auth.password import hash_password, verify_password


def test_verify_password_accepts_correct_password():
    encoded = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", encoded) is True


def test_verify_password_rejects_wrong_password():
    encoded = hash_password("correct horse battery staple")
    assert verify_password("wrong password", encoded) is False


def test_hash_password_salts_every_call_differently():
    assert hash_password("same") != hash_password("same")


def test_verify_password_rejects_garbage_encoded_value():
    assert verify_password("anything", "not-a-valid-hash") is False
