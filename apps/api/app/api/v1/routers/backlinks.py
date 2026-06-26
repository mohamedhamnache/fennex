from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_backlinks():
    return {"message": "Not implemented yet"}


@router.post("/analyze", status_code=202)
async def analyze_backlinks():
    return {"message": "Not implemented yet"}


@router.get("/opportunities")
async def get_backlink_opportunities():
    return {"message": "Not implemented yet"}


@router.get("/{backlink_id}")
async def get_backlink(backlink_id: str):
    return {"message": "Not implemented yet"}
