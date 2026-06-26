from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_content_items():
    return {"message": "Not implemented yet"}


@router.post("", status_code=201)
async def create_content_item():
    return {"message": "Not implemented yet"}


@router.get("/{item_id}")
async def get_content_item(item_id: str):
    return {"message": "Not implemented yet"}


@router.patch("/{item_id}")
async def update_content_item(item_id: str):
    return {"message": "Not implemented yet"}
