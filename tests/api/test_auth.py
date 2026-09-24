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
