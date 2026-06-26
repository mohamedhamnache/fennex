from fastapi import APIRouter

router = APIRouter()


@router.post("", status_code=201)
async def create_organization():
    return {"message": "Not implemented yet"}


@router.get("/{org_id}")
async def get_organization(org_id: str):
    return {"message": "Not implemented yet"}


@router.patch("/{org_id}")
async def update_organization(org_id: str):
    return {"message": "Not implemented yet"}


@router.get("/{org_id}/members")
async def list_members(org_id: str):
    return {"message": "Not implemented yet"}
