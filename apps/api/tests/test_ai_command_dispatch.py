"""_DISPATCH in ai_command.py maps a parsed operation name to a lambda that
forwards (image_url, params, mask_url) into the matching editing_service
function. Three entries (replace_background, insert_object, generative_fill)
previously passed `mask` into the `prompt` positional slot and the actual
prompt text into the `mask_url` slot -- every mask-based AI-command edit sent
the mask URL as the text prompt and the user's instruction as the mask,
guaranteeing a broken or rejected Replicate call. This locks the correct
positional order in place.
"""
import pytest
from unittest.mock import AsyncMock, patch

from app.api.v1.routers.ai_command import _DISPATCH


@pytest.mark.asyncio
async def test_replace_background_passes_prompt_and_mask_in_order():
    with patch("app.services.editing_service.replace_background", AsyncMock(return_value={"ok": True})) as mock:
        await _DISPATCH["replace_background"]("https://img", {"prompt": "green marble backdrop"}, "https://mask")
    mock.assert_awaited_once_with("https://img", "green marble backdrop", "https://mask")


@pytest.mark.asyncio
async def test_insert_object_passes_prompt_and_mask_in_order():
    with patch("app.services.editing_service.insert_object", AsyncMock(return_value={"ok": True})) as mock:
        await _DISPATCH["insert_object"]("https://img", {"prompt": "a red balloon"}, "https://mask")
    mock.assert_awaited_once_with("https://img", "a red balloon", "https://mask")


@pytest.mark.asyncio
async def test_generative_fill_passes_prompt_and_mask_in_order():
    with patch("app.services.editing_service.generative_fill", AsyncMock(return_value={"ok": True})) as mock:
        await _DISPATCH["generative_fill"]("https://img", {"prompt": "seamless wood grain"}, "https://mask")
    mock.assert_awaited_once_with("https://img", "seamless wood grain", "https://mask")


@pytest.mark.asyncio
async def test_replace_background_defaults_missing_mask_and_prompt_to_empty_string():
    with patch("app.services.editing_service.replace_background", AsyncMock(return_value={"ok": True})) as mock:
        await _DISPATCH["replace_background"]("https://img", {}, None)
    mock.assert_awaited_once_with("https://img", "", "")


@pytest.mark.asyncio
async def test_remove_object_still_passes_mask_in_its_own_slot():
    """remove_object/smart_erase were already correctly ordered -- guard against
    a future refactor reintroducing the swap."""
    with patch("app.services.editing_service.remove_object", AsyncMock(return_value={"ok": True})) as mock:
        await _DISPATCH["remove_object"]("https://img", {}, "https://mask")
    mock.assert_awaited_once_with("https://img", "https://mask")
