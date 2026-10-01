import pytest


@pytest.mark.asyncio
async def test_me_without_login_is_not_authenticated(anonymous_client):
    response = await anonymous_client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json() == {"authenticated": False}


@pytest.mark.asyncio
async def test_login_with_wrong_password_is_401(client):
    response = await client.post("/api/auth/login", json={"password": "wrong"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_with_correct_password_authenticates(client):
    response = await client.post("/api/auth/login", json={"password": "admin"})
    assert response.status_code == 200
    assert response.json() == {"authenticated": True}

    me_response = await client.get("/api/auth/me")
    assert me_response.json() == {"authenticated": True}


@pytest.mark.asyncio
async def test_logout_clears_the_session(client):
    await client.post("/api/auth/login", json={"password": "admin"})
    await client.post("/api/auth/logout")

    me_response = await client.get("/api/auth/me")
    assert me_response.json() == {"authenticated": False}


@pytest.mark.asyncio
async def test_login_is_locked_after_repeated_wrong_passwords(anonymous_client):
    for _ in range(5):
        response = await anonymous_client.post("/api/auth/login", json={"password": "wrong"})
        assert response.status_code == 401

    # Even the right password is refused during the cool-down.
    response = await anonymous_client.post("/api/auth/login", json={"password": "admin"})
    assert response.status_code == 429
    assert int(response.headers["Retry-After"]) > 0
    me_response = await anonymous_client.get("/api/auth/me")
    assert me_response.json() == {"authenticated": False}


@pytest.mark.asyncio
async def test_successful_login_resets_the_failure_count(anonymous_client):
    for _ in range(4):
        await anonymous_client.post("/api/auth/login", json={"password": "wrong"})
    ok = await anonymous_client.post("/api/auth/login", json={"password": "admin"})
    assert ok.status_code == 200

    for _ in range(4):
        response = await anonymous_client.post("/api/auth/login", json={"password": "wrong"})
        assert response.status_code == 401


@pytest.mark.asyncio
async def test_admin_login_shares_the_same_lockout(anonymous_client):
    for _ in range(5):
        await anonymous_client.post("/api/auth/login", json={"password": "wrong"})

    response = await anonymous_client.post(
        "/admin/login", data={"username": "x", "password": "admin"}, follow_redirects=False
    )

    assert response.status_code == 400  # SQLAdmin re-renders the login page on a failed login
    page = await anonymous_client.get("/admin/")
    assert page.status_code in (302, 307)  # still not authenticated
