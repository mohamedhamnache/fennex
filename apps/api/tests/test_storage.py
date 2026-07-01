from unittest.mock import MagicMock, patch
import pytest
from app.core.storage import _public_url, upload_bytes
from app.core.config import settings


def test_public_url_supabase(monkeypatch):
    monkeypatch.setattr(settings, "S3_ENDPOINT_URL", "https://abc.supabase.co/storage/v1/s3")
    monkeypatch.setattr(settings, "S3_BUCKET", "fennex-assets")
    url = _public_url("brand-kit/oid/logo.png")
    assert url == "https://abc.supabase.co/storage/v1/object/public/fennex-assets/brand-kit/oid/logo.png"


def test_public_url_aws(monkeypatch):
    monkeypatch.setattr(settings, "S3_ENDPOINT_URL", "")
    monkeypatch.setattr(settings, "S3_BUCKET", "mybucket")
    monkeypatch.setattr(settings, "S3_REGION", "us-east-1")
    url = _public_url("some/key.png")
    assert url == "https://mybucket.s3.us-east-1.amazonaws.com/some/key.png"


@pytest.mark.asyncio
async def test_upload_bytes_calls_put_object(monkeypatch):
    monkeypatch.setattr(settings, "S3_ENDPOINT_URL", "")
    monkeypatch.setattr(settings, "S3_BUCKET", "testbucket")
    monkeypatch.setattr(settings, "S3_REGION", "us-east-1")
    mock_client = MagicMock()
    with patch("app.core.storage._s3_client", return_value=mock_client):
        url = await upload_bytes(b"data", "test/key.png", "image/png")
    mock_client.put_object.assert_called_once_with(
        Bucket="testbucket", Key="test/key.png", Body=b"data", ContentType="image/png"
    )
    assert "testbucket" in url and "key.png" in url
