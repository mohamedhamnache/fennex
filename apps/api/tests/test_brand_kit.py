import pytest
from httpx import AsyncClient


async def test_get_brand_kit_defaults(client: AsyncClient, auth_headers: dict):
    response = await client.get("/api/v1/brand-kit", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["colors"] == []
    assert data["logo_url"] is None
    assert data["primary_font"] is None


async def test_update_brand_kit(client: AsyncClient, auth_headers: dict):
    payload = {
        "colors": ["#1A2B3C", "#FF6B35"],
        "primary_font": "Inter",
        "style_rules": "Clean white backgrounds",
        "tone": "Premium and confident",
    }
    response = await client.put("/api/v1/brand-kit", json=payload, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["colors"] == ["#1A2B3C", "#FF6B35"]
    assert data["primary_font"] == "Inter"


async def test_update_brand_kit_is_idempotent(client: AsyncClient, auth_headers: dict):
    await client.put("/api/v1/brand-kit", json={"colors": ["#AABBCC"]}, headers=auth_headers)
    response = await client.put("/api/v1/brand-kit", json={"colors": ["#112233"]}, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["colors"] == ["#112233"]
