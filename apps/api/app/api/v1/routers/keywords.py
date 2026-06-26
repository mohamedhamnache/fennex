from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def list_keywords():
    return {"message": "Not implemented yet"}


@router.post("/research", status_code=202)
async def trigger_keyword_research():
    return {"message": "Not implemented yet"}


@router.post("/cluster", status_code=202)
async def cluster_keywords():
    return {"message": "Not implemented yet"}


@router.get("/{keyword_id}")
async def get_keyword(keyword_id: str):
    return {"message": "Not implemented yet"}
