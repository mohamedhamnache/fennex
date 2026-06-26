from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_projects():
    return {"message": "Not implemented yet"}


@router.post("", status_code=201)
async def create_project():
    return {"message": "Not implemented yet"}


@router.get("/{project_id}")
async def get_project(project_id: str):
    return {"message": "Not implemented yet"}


@router.patch("/{project_id}")
async def update_project(project_id: str):
    return {"message": "Not implemented yet"}


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str):
    return {"message": "Not implemented yet"}
