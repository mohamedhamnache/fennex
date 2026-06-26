from fastapi import APIRouter

router = APIRouter()


@router.get("/overview")
async def get_analytics_overview():
    return {"message": "Not implemented yet"}


@router.get("/traffic")
async def get_traffic_analytics():
    return {"message": "Not implemented yet"}


@router.get("/rankings")
async def get_keyword_rankings():
    return {"message": "Not implemented yet"}


@router.get("/content-performance")
async def get_content_performance():
    return {"message": "Not implemented yet"}
