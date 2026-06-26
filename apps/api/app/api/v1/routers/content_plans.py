from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_content_plans():
    return {"message": "Not implemented yet"}


@router.post("", status_code=201)
async def create_content_plan():
    return {"message": "Not implemented yet"}


@router.get("/{plan_id}")
async def get_content_plan(plan_id: str):
    return {"message": "Not implemented yet"}


@router.patch("/{plan_id}")
async def update_content_plan(plan_id: str):
    return {"message": "Not implemented yet"}
