from fastapi import APIRouter

router = APIRouter()


@router.get("/me")
async def get_current_user_profile():
    return {"message": "Not implemented yet"}


@router.patch("/me")
async def update_current_user_profile():
    return {"message": "Not implemented yet"}


@router.get("/{user_id}")
async def get_user(user_id: str):
    return {"message": "Not implemented yet"}


@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: str):
    return {"message": "Not implemented yet"}
