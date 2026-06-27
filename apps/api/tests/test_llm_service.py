"""Tests for llm_service.py."""
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.security import encrypt_value
from app.models.api_key import APIKey
from app.models.organization import Organization

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

FAKE_ORG_ID = uuid.uuid4()


@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def db():
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture
async def org_with_keys(db):
    org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org")
    db.add(org)
    await db.flush()
    db.add(APIKey(org_id=FAKE_ORG_ID, provider="anthropic", encrypted_value=encrypt_value("sk-ant-test-key")))
    db.add(APIKey(org_id=FAKE_ORG_ID, provider="openai", encrypted_value=encrypt_value("sk-openai-test-key")))
    await db.commit()


@pytest.mark.asyncio
async def test_get_org_llm_keys_returns_decrypted_dict(db, org_with_keys):
    from app.services.llm_service import get_org_llm_keys
    keys = await get_org_llm_keys(FAKE_ORG_ID, db)
    assert keys == {"anthropic": "sk-ant-test-key", "openai": "sk-openai-test-key"}


@pytest.mark.asyncio
async def test_get_org_llm_keys_empty_when_no_keys(db):
    from app.services.llm_service import get_org_llm_keys
    keys = await get_org_llm_keys(FAKE_ORG_ID, db)
    assert keys == {}


@pytest.mark.asyncio
async def test_call_llm_anthropic():
    from app.services.llm_service import call_llm
    mock_content = MagicMock(text="Anthropic generated text")
    mock_message = MagicMock(content=[mock_content])
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_message)
    mock_cls = MagicMock(return_value=mock_client)

    with patch("app.services.llm_service.AsyncAnthropic", mock_cls):
        result = await call_llm("anthropic", "claude-sonnet-4-6", "sk-ant-key", "system", "user")

    assert result == "Anthropic generated text"
    mock_cls.assert_called_once_with(api_key="sk-ant-key")
    mock_client.messages.create.assert_awaited_once_with(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system="system",
        messages=[{"role": "user", "content": "user"}],
    )


@pytest.mark.asyncio
async def test_call_llm_openai():
    from app.services.llm_service import call_llm
    mock_choice = MagicMock()
    mock_choice.message.content = "OpenAI generated text"
    mock_response = MagicMock(choices=[mock_choice])
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_response)
    mock_cls = MagicMock(return_value=mock_client)

    with patch("app.services.llm_service.AsyncOpenAI", mock_cls):
        result = await call_llm("openai", "gpt-4o", "sk-openai-key", "system", "user")

    assert result == "OpenAI generated text"
    mock_cls.assert_called_once_with(api_key="sk-openai-key")


@pytest.mark.asyncio
async def test_call_llm_google():
    from app.services.llm_service import call_llm
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "candidates": [{"content": {"parts": [{"text": "Google generated text"}]}}]
    }
    mock_http_client = AsyncMock()
    mock_http_client.__aenter__ = AsyncMock(return_value=mock_http_client)
    mock_http_client.__aexit__ = AsyncMock(return_value=False)
    mock_http_client.post = AsyncMock(return_value=mock_resp)

    with patch("app.services.llm_service.httpx.AsyncClient", return_value=mock_http_client):
        result = await call_llm("google", "gemini-1.5-flash", "google-key", "system", "user")

    assert result == "Google generated text"


@pytest.mark.asyncio
async def test_call_llm_unknown_provider_raises():
    from app.services.llm_service import call_llm
    with pytest.raises(ValueError, match="Unknown provider: badprovider"):
        await call_llm("badprovider", "model", "key", "system", "user")
