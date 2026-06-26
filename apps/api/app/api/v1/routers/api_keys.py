from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_api_keys():
    return {"message": "Not implemented yet"}


@router.post("", status_code=201)
async def create_api_key():
    return {"message": "Not implemented yet"}


@router.delete("/{key_id}", status_code=204)
async def delete_api_key(key_id: str):
    return {"message": "Not implemented yet"}
