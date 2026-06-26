from fastapi import APIRouter

router = APIRouter()


@router.get("/connections")
async def list_publishing_connections():
    return {"message": "Not implemented yet"}


@router.post("/connections", status_code=201)
async def create_publishing_connection():
    return {"message": "Not implemented yet"}


@router.post("/publish", status_code=202)
async def publish_content():
    return {"message": "Not implemented yet"}


@router.get("/history")
async def get_publishing_history():
    return {"message": "Not implemented yet"}
