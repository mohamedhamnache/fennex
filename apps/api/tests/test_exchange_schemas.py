from app.schemas.backlinks import (
    ExchangeListingCreate, ExchangeRequestCreate,
    ExchangeMessageCreate, ExchangeRequestUpdate,
)
import uuid


def test_listing_create():
    obj = ExchangeListingCreate(site_url="https://example.com", niche="tech", language="en", domain_authority=40.0, description="desc")
    assert obj.site_url == "https://example.com"


def test_request_create():
    obj = ExchangeRequestCreate(
        target_project_id=uuid.uuid4(),
        requester_url="https://mine.com/page",
        target_url="https://their.com/page",
        initial_message="hi",
    )
    assert obj.initial_message == "hi"


def test_message_create():
    obj = ExchangeMessageCreate(body="hello")
    assert obj.body == "hello"


def test_request_update():
    obj = ExchangeRequestUpdate(status="accepted")
    assert obj.status == "accepted"
