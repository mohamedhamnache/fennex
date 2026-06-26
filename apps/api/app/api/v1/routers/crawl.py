from fastapi import APIRouter

router = APIRouter()


@router.post("", status_code=202)
async def trigger_crawl():
    return {"message": "Not implemented yet"}


@router.get("/{crawl_id}")
async def get_crawl_status(crawl_id: str):
    return {"message": "Not implemented yet"}


@router.get("/{crawl_id}/pages")
async def list_crawled_pages(crawl_id: str):
    return {"message": "Not implemented yet"}
